/**
 * 轻量静态检查：检查 Node 脚本和 HTML 内联脚本的语法。
 * 用法：npm run check
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const dirs = ['src', 'shared', 'tests', 'scripts'];
const htmlDir = path.join(root, 'public');
const failures = [];
let checked = 0;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return [full];
  });
}

function checkJs(file) {
  checked += 1;
  try {
    new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
  } catch (err) {
    failures.push(`${path.relative(root, file)}: ${err.message}`);
  }
}

dirs.forEach((dir) => {
  walk(path.join(root, dir))
    .filter((file) => file.endsWith('.js'))
    .forEach(checkJs);
});

walk(htmlDir)
  .filter((file) => file.endsWith('.html'))
  .forEach((file) => {
    const html = fs.readFileSync(file, 'utf8');
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
    scripts.forEach((match, index) => {
      checked += 1;
      try {
        new vm.Script(match[1], { filename: `${file}#inline-${index + 1}` });
      } catch (err) {
        failures.push(`${path.relative(root, file)} 内联脚本 ${index + 1}: ${err.message}`);
      }
    });
  });

if (failures.length > 0) {
  console.error('语法检查失败：');
  failures.forEach((failure) => console.error('- ' + failure));
  process.exitCode = 1;
} else {
  console.log(`语法检查通过：${checked} 个脚本/内联脚本`);
}
