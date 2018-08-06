/*
  Copyright 2017 Google Inc.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

const {generateSWString} = require('workbox-build');
const path = require('path');

const convertStringToAsset = require('./lib/convert-string-to-asset');
const getDefaultConfig = require('./lib/get-default-config');
const formatManifestFilename = require('./lib/format-manifest-filename');
const getAssetHash = require('./lib/get-asset-hash');
const getManifestEntriesFromCompilation =
  require('./lib/get-manifest-entries-from-compilation');
const getWorkboxSWImports = require('./lib/get-workbox-sw-imports');
const relativeToOutputPath = require('./lib/relative-to-output-path');
const sanitizeConfig = require('./lib/sanitize-config');
const stringifyManifest = require('./lib/stringify-manifest');
const warnAboutConfig = require('./lib/warn-about-config');

/**
 * This class supports creating a new, ready-to-use service worker file as
 * part of the webpack compilation process.
 *
 * Use an instance of `GenerateSW` in the
 * [`plugins` array](https://webpack.js.org/concepts/plugins/#usage) of a
 * webpack config.
 *
 * @module workbox-webpack-plugin
 */
class GenerateSW {
  /**
   * Creates an instance of GenerateSW.
   *
   * @param {Object} [config] See the
   * [configuration guide](https://developers.google.com/web/tools/workbox/modules/workbox-webpack-plugin#configuration)
   * for all supported options and defaults.
   */
  constructor(config = {}) {
    this.config = Object.assign(getDefaultConfig(), {
      // Hardcode this default filename, since we don't have swSrc to read from
      // (like we do in InjectManifest).
      swDest: 'service-worker.js',
    }, config);
  }

  /**
   * @param {Object} compilation The webpack compilation.
   * @private
   */
  async handleEmit(compilation) {
    const configWarning = warnAboutConfig(this.config);
    if (configWarning) {
      compilation.warnings.push(configWarning);
    }

    const workboxSWImports = await getWorkboxSWImports(
      compilation, this.config);
    const entries = getManifestEntriesFromCompilation(compilation, this.config);
    const importScriptsArray = [].concat(this.config.importScripts);

    const manifestString = stringifyManifest(entries);
    const manifestAsset = convertStringToAsset(manifestString);
    const manifestHash = getAssetHash(manifestAsset);

    const manifestFilename = formatManifestFilename(
      this.config.precacheManifestFilename, manifestHash);
    const pathToManifestFile = relativeToOutputPath(
      compilation, path.join(this.config.importsDirectory, manifestFilename));
    compilation.assets[pathToManifestFile] = manifestAsset;

    importScriptsArray.push((compilation.options.output.publicPath || '') +
      pathToManifestFile.split(path.sep).join('/'));

    // workboxSWImports might be null if importWorkboxFrom is 'disabled'.
    let workboxSWImport;
    if (workboxSWImports) {
      if (workboxSWImports.length === 1) {
        // When importWorkboxFrom is 'cdn' or 'local', or a chunk name
        // that only contains one JavaScript asset, then this will be a one
        // element array, containing just the Workbox SW code.
        workboxSWImport = workboxSWImports[0];
      } else {
        // If importWorkboxFrom was a chunk name that contained multiple
        // JavaScript assets, then we don't know which contains the Workbox SW
        // code. Just import them first as part of the "main" importScripts().
        importScriptsArray.unshift(...workboxSWImports);
      }
    }

    const sanitizedConfig = sanitizeConfig.forGenerateSWString(this.config);
    // If globPatterns isn't explicitly set, then default to [], instead of
    // the workbox-build.generateSWString() default.
    sanitizedConfig.globPatterns = sanitizedConfig.globPatterns || [];
    sanitizedConfig.importScripts = importScriptsArray;
    sanitizedConfig.workboxSWImport = workboxSWImport;
    const {swString, warnings} = await generateSWString(sanitizedConfig);
    compilation.warnings = compilation.warnings.concat(warnings || []);

    const relSwDest = relativeToOutputPath(compilation, this.config.swDest);
    compilation.assets[relSwDest] = convertStringToAsset(swString);
  }

  /**
   * @param {Object} [compiler] default compiler object passed from webpack
   *
   * @private
   */
  apply(compiler) {
    if ('hooks' in compiler) {
      // We're in webpack 4+.
      compiler.hooks.emit.tapPromise(
        this.constructor.name,
        (compilation) => this.handleEmit(compilation)
      );
    } else {
      // We're in webpack 2 or 3.
      compiler.plugin('emit', (compilation, callback) => {
        this.handleEmit(compilation)
          .then(callback)
          .catch(callback);
      });
    }
  }
}

module.exports = GenerateSW;
