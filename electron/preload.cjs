'use strict';

const { contextBridge } = require('electron');

// Deliberately expose diagnostics only. No filesystem, shell, IPC, or OS APIs
// are made available to renderer pages.
contextBridge.exposeInMainWorld('taibaDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
  appName: 'Taiba Smart Lab'
}));
