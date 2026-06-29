#!/usr/bin/env node
const { execSync } = require('child_process');
const os = require('os');

const platform = os.platform();
const arch = os.arch();

const archMap = { x64:'--x64', ia32:'--ia32', arm64:'--arm64', arm:'--armv7l' };
const archFlag = archMap[arch] || '--x64';

const platformMap = {
  win32:  { flag:'--win',   label:'Windows', out:['LiteIDE Setup.exe','LiteIDE 1.0.0.msi','LiteIDE.exe (portable)'] },
  darwin: { flag:'--mac',   label:'macOS',   out:['LiteIDE.dmg','LiteIDE.zip'] },
  linux:  { flag:'--linux', label:'Linux',   out:['LiteIDE.AppImage','LiteIDE.deb'] },
};

const t = platformMap[platform];
if (!t) { console.error('Unsupported platform:', platform); process.exit(1); }

console.log('\n⚡ LiteIDE Auto-Builder');
console.log('─────────────────────────');
console.log('  OS   :', t.label);
console.log('  Arch :', arch);
console.log('  Out  :', t.out.join(', '));
console.log('  Dir  : dist/\n');

try {
  execSync(`npx electron-builder ${t.flag} ${archFlag}`, { stdio: 'inherit' });
  console.log('\n✅ Build complete! Files are in dist/');
} catch(e) {
  console.error('\n❌ Build failed. See errors above.');
  process.exit(1);
}
