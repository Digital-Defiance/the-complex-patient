/**
 * React Native / Hermes-safe zip.js entry point.
 *
 * The package root re-exports `./lib/zip-fs.js`, which uses `import.meta.url`
 * and breaks Hermes bundling. The no-worker build exposes the same reader/writer
 * APIs without filesystem or worker bootstrap code.
 */

export {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js/lib/zip-no-worker.js';
