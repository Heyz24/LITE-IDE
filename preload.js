const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window
  minimize:   ()        => ipcRenderer.send('window:minimize'),
  maximize:   ()        => ipcRenderer.send('window:maximize'),
  close:      ()        => ipcRenderer.send('window:close'),
  onMaximized:(cb)      => ipcRenderer.on('window:maximized', (_, v) => cb(v)),

  // FS
  openFolder: ()        => ipcRenderer.invoke('fs:openFolder'),
  readDir:    p         => ipcRenderer.invoke('fs:readDir', p),
  readFile:   p         => ipcRenderer.invoke('fs:readFile', p),
  writeFile:  (p, c)   => ipcRenderer.invoke('fs:writeFile', p, c),
  newFile:    dir       => ipcRenderer.invoke('fs:newFile', dir),
  deleteFile: p         => ipcRenderer.invoke('fs:delete', p),

  // Language
  detectLang: lang      => ipcRenderer.invoke('lang:detect', lang),

  // Run
  runCode:    (f, l)   => ipcRenderer.invoke('code:run', f, l),
  stopCode:   ()        => ipcRenderer.invoke('code:stop'),
  onStdout:   cb        => ipcRenderer.on('process:stdout', (_, d) => cb(d)),
  onStderr:   cb        => ipcRenderer.on('process:stderr', (_, d) => cb(d)),
  onExit:     cb        => ipcRenderer.on('process:exit',   (_, c) => cb(c)),
  onRunError: cb        => ipcRenderer.on('process:error',  (_, e) => cb(e)),

  // Shell
  getShells:    ()      => ipcRenderer.invoke('shell:getAvailable'),
  spawnShell:   cmd     => ipcRenderer.invoke('shell:spawn', cmd),
  processInput: data    => ipcRenderer.send('process:input', data),
  shellInput:   data    => ipcRenderer.send('shell:input', data),
  shellCd:      dir     => ipcRenderer.send('shell:cd', dir),
  resizePty:    (c, r)  => ipcRenderer.send('shell:resize', c, r),
  killShell:    ()      => ipcRenderer.send('shell:kill'),
  onShellOutput: cb     => ipcRenderer.on('shell:output', (_, d) => cb(d)),
  onShellExit:   cb     => ipcRenderer.on('shell:exit',   ()      => cb()),
  onShellError:  cb     => ipcRenderer.on('shell:error',  (_, e)  => cb(e)),

  // Misc
  openExternal: url     => ipcRenderer.send('open:external', url),
  getPlatform:  ()      => ipcRenderer.invoke('app:platform'),
  getHomedir:   ()      => ipcRenderer.invoke('app:homedir'),
});
