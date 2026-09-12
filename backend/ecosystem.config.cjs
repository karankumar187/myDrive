module.exports = {
  apps: [
    {
      name: 'drive-api',
      script: './dist/server.js',
      instances: 'max', // Uses all available CPU cores (4 on Oracle Ampere A1)
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
