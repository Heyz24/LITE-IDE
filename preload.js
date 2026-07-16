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
  processInput: data    => ipcRenderer.send('process:input', data),
  onStdout:   cb        => ipcRenderer.on('process:stdout', (_, d) => cb(d)),
  onStderr:   cb        => ipcRenderer.on('process:stderr', (_, d) => cb(d)),
  onExit:     cb        => ipcRenderer.on('process:exit',   (_, c) => cb(c)),
  onRunError: cb        => ipcRenderer.on('process:error',  (_, e) => cb(e)),

  // Terminal (multi-session)
  getShells:    ()             => ipcRenderer.invoke('shell:getAvailable'),
  termCreate:   (id, cmd)      => ipcRenderer.invoke('term:create', id, cmd),
  termInput:    (id, data)     => ipcRenderer.send('term:input', id, data),
  termCd:       (id, dir)      => ipcRenderer.send('term:cd', id, dir),
  termResize:   (id, c, r)     => ipcRenderer.send('term:resize', id, c, r),
  termClose:    (id)           => ipcRenderer.send('term:close', id),
  onTermOutput: cb             => ipcRenderer.on('term:output', (_, d) => cb(d)),
  onTermExit:   cb             => ipcRenderer.on('term:exit',   (_, d) => cb(d)),
  onTermError:  cb             => ipcRenderer.on('term:error',  (_, d) => cb(d)),

  // Project search & replace
  searchProject: (q, opts)              => ipcRenderer.invoke('search:project', q, opts),
  replaceAll:    (q, r, opts, files)    => ipcRenderer.invoke('search:replaceAll', q, r, opts, files),

  // Git
  gitIsRepo: ()          => ipcRenderer.invoke('git:isRepo'),
  gitStatus: ()          => ipcRenderer.invoke('git:status'),
  gitDiff:   relPath     => ipcRenderer.invoke('git:diff', relPath),

  // Misc
  openExternal: url     => ipcRenderer.send('open:external', url),
  onOpenPath:   cb      => ipcRenderer.on('app:openPath', (_, p) => cb(p)),
  getPlatform:  ()      => ipcRenderer.invoke('app:platform'),
  getHomedir:   ()      => ipcRenderer.invoke('app:homedir'),

  // ── AI Agent ──
  ai: {
    getConfig:        ()                      => ipcRenderer.invoke('ai:getConfig'),
    saveConfig:       (cfg)                   => ipcRenderer.invoke('ai:saveConfig', cfg),
    listOllamaModels: ()                      => ipcRenderer.invoke('ai:listOllamaModels'),
    clearKey:         (provider)              => ipcRenderer.invoke('ai:clearKey', provider),
    chatOnce:         (payload)               => ipcRenderer.invoke('ai:chatOnce', payload),
  },
  agent: {
    setProjectRoot: root            => ipcRenderer.invoke('agent:setProjectRoot', root),
    readFile:       relPath         => ipcRenderer.invoke('agent:readFile', relPath),
    listDir:        relPath         => ipcRenderer.invoke('agent:listDir', relPath),
    writeFile:      (relPath, c)    => ipcRenderer.invoke('agent:writeFile', relPath, c),
    editFile:       (relPath, o, n) => ipcRenderer.invoke('agent:editFile', relPath, o, n),
    deleteFile:     relPath         => ipcRenderer.invoke('agent:deleteFile', relPath),
    runCommand:     (cmd, opts)     => ipcRenderer.invoke('agent:runCommand', cmd, opts),
    getSandboxStatus: ()            => ipcRenderer.invoke('agent:getSandboxStatus'),
    ragSearch:      (q, topK)       => ipcRenderer.invoke('agent:ragSearch', q, topK),
    webSearch:      query           => ipcRenderer.invoke('agent:webSearch', query),
    webFetch:       url             => ipcRenderer.invoke('agent:webFetch', url),
    listSkills:     ()              => ipcRenderer.invoke('agent:listSkills'),
    saveSkill:      (name, content) => ipcRenderer.invoke('agent:saveSkill', name, content),
    deleteSkill:    name            => ipcRenderer.invoke('agent:deleteSkill', name),
    checkpoint:     (relPath, msg)  => ipcRenderer.invoke('agent:checkpoint', relPath, msg),
    cancelRequest:  requestId       => ipcRenderer.send('agent:cancelRequest', requestId),
    getUsage:       ()              => ipcRenderer.invoke('agent:getUsage'),
    setBudgetCap:   (cap)           => ipcRenderer.invoke('agent:setBudgetCap', cap),
    resetUsage:     ()              => ipcRenderer.invoke('agent:resetUsage'),
    getVerifyConfig: ()             => ipcRenderer.invoke('agent:getVerifyConfig'),
    setVerifyConfig: (cfg)          => ipcRenderer.invoke('agent:setVerifyConfig', cfg),
    getPermissions: ()              => ipcRenderer.invoke('agent:getPermissions'),
    setPermissions: (perms)         => ipcRenderer.invoke('agent:setPermissions', perms),
    gateSubagents:  taskCount       => ipcRenderer.invoke('agent:gateSubagents', taskCount),
    requestPermissionEscalation: (category, reason) => ipcRenderer.invoke('agent:requestPermissionEscalation', category, reason),
    respondApproval:(id, approved)  => ipcRenderer.send('agent:approvalResponse', { id, approved }),
    onApprovalRequest: cb           => ipcRenderer.on('agent:approvalRequest', (_, req) => cb(req)),
    onCommandOutput:   cb           => ipcRenderer.on('agent:commandOutput', (_, d) => cb(d)),
  },
});
