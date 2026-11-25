#!/usr/bin/env node
/**
 * 检测一木记账 App 的最新发布版本，供 `.github/workflows/app-version.yml` 使用。
 *
 * 数据源（都不需要密钥）：
 *   - iOS：Apple App Store lookup JSON（trackId 1572969723）；
 *   - Android：腾讯应用宝详情页内嵌的 __NEXT_DATA__（包名 com.wangc.bill），
 *     解析失败时退回小米应用商店详情页的「版本号」。
 *
 * 输出：向 stdout 打印 JSON 摘要；设置了 GITHUB_OUTPUT 时追加 key=value 行：
 *   ios_version / ios_released / android_version / android_source / android_updated / key
 *
 * 两个平台都必须解析成功：任一平台取不到版本时退出 1，让 CI 明确变红，
 * 而不是在版本信号丢失时静默跳过。单一数据源失败会先重试，Android 还有小米兜底。
 */

const IOS_APP_ID = "1572969723";
const ANDROID_PACKAGE = "com.wangc.bill";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

async function fetchText(url, { attempts = 3, timeoutMs = 25_000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": USER_AGENT,
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError;
}

/** iOS：Apple 官方 lookup API，版本与发布日期都在 JSON 里。 */
async function iosVersion() {
  const body = await fetchText(
    `https://itunes.apple.com/lookup?id=${IOS_APP_ID}&country=cn&t=${Date.now()}`,
  );
  const data = JSON.parse(body);
  const app = (data.results || []).find((item) => String(item.trackId) === IOS_APP_ID);
  if (!app?.version) throw new Error("App Store lookup 没有返回版本号");
  return {
    version: String(app.version),
    released: String(app.currentVersionReleaseDate || ""),
    name: String(app.trackName || ""),
  };
}

/** 递归收集 __NEXT_DATA__ 里属于目标包名的对象（详情卡片、推荐位都可能带版本）。 */
function collectPackageNodes(node, out, seen = new Set()) {
  if (node === null || typeof node !== "object" || seen.has(node)) return out;
  seen.add(node);
  if (node.pkg_name === ANDROID_PACKAGE && typeof node.version_name === "string") {
    out.push(node);
  }
  for (const value of Object.values(node)) collectPackageNodes(value, out, seen);
  return out;
}

function parseNextData(html) {
  const match = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("应用宝页面缺少 __NEXT_DATA__");
  return JSON.parse(match[1]);
}

/** Android 主来源：腾讯应用宝。 */
async function tencentVersion() {
  const html = await fetchText(`https://sj.qq.com/appdetail/${ANDROID_PACKAGE}`);
  const nodes = collectPackageNodes(parseNextData(html), []);
  if (nodes.length === 0) throw new Error("应用宝 __NEXT_DATA__ 里没有 com.wangc.bill");
  nodes.sort((a, b) => Number(b.update_time || 0) - Number(a.update_time || 0));
  const app = nodes[0];
  const updated = Number(app.update_time || 0);
  return {
    version: String(app.version_name),
    updated: updated > 0 ? new Date(updated * 1000).toISOString() : "",
    source: "tencent",
    name: String(app.name || ""),
  };
}

/** Android 兜底：小米应用商店的「版本号」行。 */
async function xiaomiVersion() {
  const html = await fetchText(`https://app.mi.com/details?id=${ANDROID_PACKAGE}`);
  const match = html.match(/版本号[\s\S]{0,600}?(\d+\.\d+\.\d+)/);
  if (!match) throw new Error("小米应用商店页面没有解析到版本号");
  return { version: match[1], updated: "", source: "xiaomi", name: "" };
}

async function androidVersion() {
  try {
    return await tencentVersion();
  } catch (tencentError) {
    console.error(`tencent failed: ${tencentError instanceof Error ? tencentError.message : tencentError}`);
    return xiaomiVersion();
  }
}

/** GitHub Actions 输出值和缓存 key 都只接受有限字符。 */
function safe(value) {
  return String(value ?? "").replace(/[^0-9A-Za-z._-]+/g, "-");
}

const [ios, android] = await Promise.allSettled([iosVersion(), androidVersion()]);
const failures = [];
if (ios.status === "rejected") failures.push(`ios: ${ios.reason?.message ?? ios.reason}`);
if (android.status === "rejected") failures.push(`android: ${android.reason?.message ?? android.reason}`);
if (failures.length > 0) {
  console.error(`无法确定一木记账 App 最新版本：\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

const iosInfo = ios.value;
const androidInfo = android.value;
const key = `ios-${safe(iosInfo.version)}_android-${safe(androidInfo.version)}`;

const summary = {
  ios: { version: iosInfo.version, released: iosInfo.released },
  android: { version: androidInfo.version, updated: androidInfo.updated, source: androidInfo.source },
  key,
};
console.log(JSON.stringify(summary, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    "### 一木记账 App 最新版本",
    "",
    `- iOS: \`${iosInfo.version}\`${iosInfo.released ? `（${iosInfo.released}）` : ""}`,
    `- Android: \`${androidInfo.version}\`（来源 ${androidInfo.source}${androidInfo.updated ? `，${androidInfo.updated}` : ""}）`,
    `- 版本 key: \`${key}\``,
    "",
  ];
  try {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
  } catch {
    // 摘要写不进去不影响版本判断。
  }
}

if (process.env.GITHUB_OUTPUT) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `ios_version=${safe(iosInfo.version)}`,
      `ios_released=${iosInfo.released.replace(/[\r\n]+/g, " ")}`,
      `android_version=${safe(androidInfo.version)}`,
      `android_updated=${androidInfo.updated.replace(/[\r\n]+/g, " ")}`,
      `android_source=${safe(androidInfo.source)}`,
      `key=${safe(key)}`,
      "",
    ].join("\n"),
  );
}
