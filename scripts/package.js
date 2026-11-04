// Packages the editor with Electron. Usage: node scripts/package.js <platform> <arch> [outDir]
// Only app/, electron/ and package.json go into the bundle.
const { packager } = require('@electron/packager');
const path = require('path');

const [platform = process.platform, arch = process.arch, out = 'dist'] = process.argv.slice(2);
const KEEP = [/^\/package\.json$/, /^\/app(\/|$)/, /^\/electron(\/|$)/];

packager({
  dir: path.join(__dirname, '..'),
  name: 'ToneLab SE Editor',
  platform, arch, out,
  overwrite: true,
  icon: path.join(__dirname, '..', 'electron', { darwin: 'icon.icns', win32: 'icon.ico' }[platform] || 'icon.png'),
  appBundleId: 'local.tonelabse.editor',
  appCategoryType: 'public.app-category.music',
  win32metadata: { CompanyName: 'alienbrainfarm', FileDescription: 'ToneLab SE Editor', ProductName: 'ToneLab SE Editor' },
  ignore: p => p !== '' && !KEEP.some(re => re.test(p.split(path.sep).join('/'))),
}).then(paths => console.log('Wrote ' + paths.join(', ')))
  .catch(e => { console.error(e); process.exit(1); });
