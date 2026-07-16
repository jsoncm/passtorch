import envPaths from 'env-paths';

const paths = envPaths('passtorch', { suffix: '' });

export const config = {
  dataDir: paths.data,
  logDir: paths.log,
  // Other configs will be added here
};
