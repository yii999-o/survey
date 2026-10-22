/**
 * 可选的浏览器端到端检查（使用本机 Chrome/Edge，不下载浏览器）。
 *
 * 前置：应用已启动，且已执行 db:init + seed。
 * 运行：node scripts/e2e-ui.js
 *
 * 环境变量：
 *   E2E_BASE_URL  默认 http://127.0.0.1:3000
 *   CHROME_PATH   浏览器可执行文件路径
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { chromium } = require('playwright-core');

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/survey_app';
const created = { surveyIds: [], responseIds: [] };
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((candidate) => {
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
});

if (!chromePath) {
  console.error('未找到 Chrome/Edge，可通过 CHROME_PATH 指定浏览器路径。');
  process.exit(1);
}

const shotsDir = path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(shotsDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function login(page, username, password) {
  await page.goto(BASE + '/login.html', { waitUntil: 'domcontentloaded' });
  await page.fill('#username', username);
  await page.fill('#password', password);
  await Promise.all([
    page.waitForURL('**/dashboard.html', { timeout: 15000 }),
    page.click('#loginBtn')
  ]);
  await page.waitForSelector('.survey-item', { timeout: 15000 });
}

async function apiCreateLockedSurvey() {
  const loginRes = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo', password: 'demo123' })
  });
  assert(loginRes.ok, 'API 登录失败');
  const { token } = await loginRes.json();
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + token
  };

  const createRes = await fetch(BASE + '/api/surveys', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'UI 登录限制检查 ' + Date.now(),
      allowAnonymous: false,
      questions: [{
        qid: 'q1',
        type: 'single',
        title: '登录后才能看到这道题',
        required: true,
        options: [
          { key: 'A', label: '知道了' },
          { key: 'B', label: '再看看' }
        ],
        jumps: []
      }]
    })
  });
  assert(createRes.status === 201, '创建测试问卷失败');
  const survey = await createRes.json();
  const publishRes = await fetch(BASE + '/api/surveys/' + survey._id + '/publish', {
    method: 'POST',
    headers
  });
  assert(publishRes.ok, '发布测试问卷失败');
  const published = await publishRes.json();
  return { shareCode: published.shareCode, surveyId: survey._id };
}

async function cleanupE2EData() {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    const db = mongoose.connection.db;
    const ids = created.surveyIds.filter(Boolean).map((id) => new mongoose.Types.ObjectId(id));
    // 清理历史上因中断遗留的 UI 测试问卷。
    const leftovers = await db.collection('surveys').find({
      title: { $regex: '^UI (自动化问卷|登录限制检查)' }
    }).project({ _id: 1 }).toArray();
    leftovers.forEach((item) => ids.push(item._id));
    const uniqueIds = [...new Map(ids.map((id) => [String(id), id])).values()];

    if (uniqueIds.length > 0) {
      await db.collection('responses').deleteMany({ surveyId: { $in: uniqueIds } });
      await db.collection('surveys').deleteMany({ _id: { $in: uniqueIds } });
    }
    if (created.responseIds.length > 0) {
      await db.collection('responses').deleteMany({
        _id: { $in: created.responseIds.map((id) => new mongoose.Types.ObjectId(id)) }
      });
    }
    console.log('[E2E] 已清理测试问卷与测试答卷');
  } finally {
    await mongoose.disconnect();
  }
}

async function main() {
  console.log('[E2E] 浏览器：', chromePath);
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));

    // 1. 登录 + 我的问卷
    await login(page, 'demo', 'demo123');
    assert(await page.locator('text=我的问卷').count() > 0, '未进入我的问卷页');
    await page.screenshot({ path: path.join(shotsDir, '01-dashboard.png'), fullPage: true });
    console.log('[E2E] 登录、我的问卷：通过');

    // 2. 统计页（定位到演示问卷，避免受新建问卷排序影响）
    const demoItem = page.locator('.survey-item:has-text("课程问卷系统演示")').first();
    await Promise.all([
      page.waitForURL('**/stats.html?id=*', { timeout: 15000 }),
      demoItem.locator('button:has-text("统计结果")').click()
    ]);
    await page.waitForSelector('#summaryCard', { state: 'visible', timeout: 15000 });
    const totalText = await page.locator('#totalResponses').textContent();
    assert(Number(totalText) >= 3, '统计页总答卷数异常：' + totalText);
    assert((await page.locator('.stat-row').count()) > 0, '统计页没有选项统计');
    await page.screenshot({ path: path.join(shotsDir, '02-stats.png'), fullPage: true });
    console.log('[E2E] 统计页：通过，总答卷数 =', totalText);

    // 3. 新建问卷（编辑页）
    await page.goto(BASE + '/edit.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#title');
    const uniqueTitle = 'UI 自动化问卷 ' + Date.now();
    await page.fill('#title', uniqueTitle);
    await page.fill('#description', '用于验证编辑、发布、锁定题目结构。');
    await page.check('#allowAnonymous');
    await page.click('[data-add="single"]');
    const qCard = page.locator('.question-card').first();
    await qCard.locator('input[placeholder="请输入题目标题"]').fill('你愿意推荐本系统吗？');
    const optionInputs = qCard.locator('.option-row input[type="text"]');
    await optionInputs.nth(0).fill('愿意');
    await optionInputs.nth(1).fill('不愿意');
    await page.click('#saveBtn');
    await page.waitForFunction(
      () => document.getElementById('success').textContent.includes('已保存'),
      null,
      { timeout: 15000 }
    );
    created.surveyIds.push(new URL(page.url()).searchParams.get('id'));
    await page.screenshot({ path: path.join(shotsDir, '03-edit.png'), fullPage: true });

    await page.click('#publishBtn');
    await page.waitForFunction(
      () => document.getElementById('success').textContent.includes('发布成功'),
      null,
      { timeout: 15000 }
    );
    assert(await page.locator('#lockNotice').isVisible(), '发布后没有显示题目锁定提示');
    const publicHref = await page.locator('#openLink').getAttribute('href');
    assert(publicHref && publicHref.startsWith('/survey/'), '发布后没有公开链接');
    console.log('[E2E] 新建、保存、发布、锁题：通过');

    // 4. 匿名填写 + 跳转
    const fillContext = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const fillPage = await fillContext.newPage();
    fillPage.on('pageerror', (err) => errors.push('fill pageerror: ' + err.message));
    await fillPage.goto(BASE + '/survey/democode0001', { waitUntil: 'domcontentloaded' });
    await fillPage.waitForSelector('#surveyPanel', { state: 'visible', timeout: 15000 });

    const q2 = fillPage.locator('section.fill-question:has-text("你希望系统增加什么功能")');
    assert(await q2.isVisible(), '第 2 题初始应可见');
    await fillPage.locator('input[name="q_q1"][value="A"]').check();
    await fillPage.waitForTimeout(200);
    assert(!(await q2.isVisible()), '选择“使用过”后第 2 题应隐藏');

    const q3 = fillPage.locator('section.fill-question:has-text("你最喜欢哪些题型")');
    await q3.locator('input[value="A"]').check();
    await q3.locator('input[value="B"]').check();
    const q4 = fillPage.locator('section.fill-question:has-text("请给系统打分")');
    await q4.locator('input[type="number"]').fill('10');
    const q5 = fillPage.locator('section.fill-question:has-text("其他建议")');
    await q5.locator('textarea').fill('浏览器端到端测试');
    await fillPage.screenshot({ path: path.join(shotsDir, '04-fill.png'), fullPage: true });

    await fillPage.click('#submitBtn');
    await fillPage.waitForFunction(
      () => document.getElementById('success').textContent.includes('提交成功'),
      null,
      { timeout: 15000 }
    );
    const successText = await fillPage.locator('#success').textContent();
    const responseMatch = successText.match(/([a-f0-9]{24})/i);
    if (responseMatch) created.responseIds.push(responseMatch[1]);
    console.log('[E2E] 匿名填写、跳转、提交：通过');

    // 5. 必答校验提示
    const invalidContext = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    const invalidPage = await invalidContext.newPage();
    await invalidPage.goto(BASE + '/survey/democode0001', { waitUntil: 'domcontentloaded' });
    await invalidPage.waitForSelector('#submitBtn');
    await invalidPage.click('#submitBtn');
    await invalidPage.waitForFunction(
      () => document.getElementById('error').textContent.length > 0,
      null,
      { timeout: 10000 }
    );
    console.log('[E2E] 前端必答校验提示：通过');

    // 6. 需要登录的问卷
    const locked = await apiCreateLockedSurvey();
    created.surveyIds.push(locked.surveyId);
    const lockedContext = await browser.newContext();
    const lockedPage = await lockedContext.newPage();
    await lockedPage.goto(BASE + '/survey/' + locked.shareCode, { waitUntil: 'domcontentloaded' });
    await lockedPage.waitForSelector('#loginPrompt', { state: 'visible', timeout: 15000 });
    assert(
      (await lockedPage.locator('#loginPrompt').textContent()).includes('需要登录'),
      '需要登录的问卷没有显示登录提示'
    );
    await lockedPage.screenshot({ path: path.join(shotsDir, '05-login-required.png'), fullPage: true });
    console.log('[E2E] 需要登录的问卷提示：通过');

    if (errors.length > 0) {
      throw new Error('页面 JavaScript 错误：\n' + errors.join('\n'));
    }
    console.log('[E2E] 全部浏览器检查通过。截图目录：docs/screenshots/');
  } finally {
    await browser.close();
    try {
      await cleanupE2EData();
    } catch (cleanupErr) {
      console.error('[E2E] 清理测试数据失败：', cleanupErr.message);
    }
  }
}

main().catch((err) => {
  console.error('[E2E] 失败：', err.message);
  process.exitCode = 1;
});
