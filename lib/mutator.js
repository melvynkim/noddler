/**
 * Created by melvynkim on 22/02/2017.
 */

'use strict';

const _ = require('lodash');
const Bb = require('bluebird');
const glob = require('glob');

/**
 * Get files by glob patterns
 */
function getGlobbedFiles(globPatterns, removeRoot) {
  // URL paths regex
  const urlRegex = new RegExp('^(?:[a-z]+:)?//', 'i');

  // The output array
  let output = [];

  // If glob pattern is array so we use each pattern in a recursive way, otherwise we use glob
  if (Array.isArray(globPatterns)) {
    globPatterns.forEach((globPattern) => {
      output = _.union(output, getGlobbedFiles(globPattern, removeRoot));
    });
  } else if (_.isString(globPatterns)) {
    if (urlRegex.test(globPatterns)) {
      output.push(globPatterns);
    } else {
      let result = glob.sync(globPatterns);
      if (removeRoot) {
        result = result.map((file) => file.replace(removeRoot, ''));
      }
      output = _.union(output, result);
    }
  }

  return output;
}

function getFiles(path, baseFolder) {
  let fullPath;
  if (Array.isArray(path)) {
    fullPath = path.map((oneSourcePath) => `${baseFolder}/${oneSourcePath}`);
  } else {
    fullPath = `${baseFolder}/${path}`;
  }
  return getGlobbedFiles(fullPath, './');
}

function resolveFile(resolver, file) {
  const resolvedModule = resolver(file);
  // support es6 modules
  return resolvedModule.__esModule ? resolvedModule.default : resolvedModule;
}

module.exports = {
  createConfig(app, mutation) {
    app.getGlobbedFiles = getGlobbedFiles;
    const { resolver, baseFolder = '', configs = [] } = mutation;
    return _.defaultsDeep(...getFiles(configs, baseFolder).map(
      (file) => resolveFile(resolver, file)
    ));
  },
  mutate(app, mutation) {
    const { resolver, baseFolder = '', phases = [] } = mutation;
    return Bb
      .mapSeries(phases, (phase) => {
        const {
          baseFolder: phaseBaseFolder = baseFolder,
          sources = {},
          makers = [],
          shouldRun = () => true,
        } = phase;

        if (shouldRun(app)) {
          // create sources
          sources.forEach(({
            name,
            path: sourcePath,
            fileFilter = (files) => files,
            merge = false,
            resolve = true,
          }) => {
            const files = fileFilter(getFiles(sourcePath, phaseBaseFolder), app);
            let sourceModules;
            if (!merge) {
              if (resolve) {
                sourceModules = files.map((filePath) => resolveFile(resolver, filePath));
              } else {
                sourceModules = files;
              }
            } else if (resolve) {
              sourceModules = _.merge(...files.map((file) => resolveFile(resolver, file)));
            } else {
              throw new Error('Invalid mutator: merge is not compatible with no resolving');
            }
            Object.defineProperties(app, {
              [name]: {
                get() {
                  return sourceModules;
                },
              },
            });
          });

          // init makers
          return Bb.mapSeries(makers, (makerPath) => (
            Bb.mapSeries(getFiles(makerPath, phaseBaseFolder), (filePath) => {
              const maker = resolveFile(resolver, filePath);
              if (_.isFunction(maker.init)) {
                return maker.init(app);
              } else if (_.isFunction(maker)) {
                return maker(app);
              } else {
                return maker;
              }
            })
          ));
        }
      });
  },
};
