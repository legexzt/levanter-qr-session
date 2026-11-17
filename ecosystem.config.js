// PM2 ecosystem file — starts all LEGEZT services with supervision limits.
// What: one file so PM2 applies the same crash/restart policy to every app.
// Called by: deploy.sh (pm2 startOrRestart ecosystem.config.js --only <app>)
//   and by `pm2 startup` + `pm2 save`, so the apps come back after an EC2
//   reboot (P0, F-05/F-07). Without this file PM2 runs with defaults: no
//   memory limit, no crash-loop policy, and a process that crashes 10 times
//   fast is marked `errored` and never restarted again.
// Needs: PM2. Levanter is included so a fresh `pm2 start ecosystem.config.js`
//   brings it back too, but deploy.sh does NOT restart Levanter (it is the
//   fallback; only the parent stops it). Levanter starts with `pm2 start .`
//   (its documented start), so script '.' resolves via its package.json main.
module.exports = {
  apps: [
    {
      name: 'legezt-bot',
      script: 'server.js',
      cwd: '/home/ubuntu/levanter-qr-session/legezt-bot',
      instances: 1,
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'qr-session',
      script: 'server.js',
      cwd: '/home/ubuntu/levanter-qr-session/qr-session',
      instances: 1,
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'levanter',
      script: '.',
      cwd: '/home/ubuntu/levanter',
      instances: 1,
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' }
    }
  ]
};
