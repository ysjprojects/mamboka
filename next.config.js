const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  webpack: config => {
    // Voice clips and the iOS keep-alive track are imported from src/images; webpack has no default
    // loader for audio, so emit them as hashed static files and import their URLs.
    config.module.rules.push({
      test: /\.mp3$/,
      type: 'asset/resource',
      generator: {filename: 'static/audio/[hash][ext]'},
    });
    return config;
  },
};

module.exports = nextConfig;
