/**
 * PM2 Configuration for GPT Bypass Proxy Server
 */

module.exports = {
  apps: [
    {
      name: 'gpt-bypass-proxy',
      script: 'src/index.js',
      cwd: '/app',
      instances: 1,
      exec_mode: 'fork',
      
      // Environment
      env: {
        NODE_ENV: 'production',
        PORT: 10800,
        HOST: '0.0.0.0'
      },
      
      // Logging
      log_file: './logs/pm2-combined.log',
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // Process management
      min_uptime: '10s',
      max_restarts: 10,
      autorestart: true,
      restart_delay: 4000,
      
      // Memory management
      max_memory_restart: '500M',
      
      // Monitoring
      monitoring: true,
      pmx: true,
      
      // Advanced options
      node_args: '--max-old-space-size=512',
      
      // Health check
      health_check_grace_period: 3000,
      health_check_fatal_exceptions: true,
      
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 3000,
      
      // Watch and ignore
      watch: false,
      ignore_watch: [
        'node_modules',
        'logs',
        '*.log'
      ],
      
      // Source map support
      source_map_support: true,
      
      // Instance variables
      instance_var: 'INSTANCE_ID',
      
      // Cron restart (optional - restart daily at 3 AM)
      cron_restart: '0 3 * * *',
      
      // Exponential backoff restart delay
      exp_backoff_restart_delay: 100
    }
  ],
  
  // Deployment configuration
  deploy: {
    production: {
      user: 'deploy',
      host: ['your-server.com'],
      ref: 'origin/main',
      repo: 'https://github.com/your-username/gpt-bypass-proxy.git',
      path: '/var/www/gpt-bypass-proxy',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      'pre-setup': '',
      'ssh_options': 'ForwardAgent=yes'
    }
  }
};
