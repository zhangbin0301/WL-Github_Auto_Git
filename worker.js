// Cloudflare Worker - 定时向 GitHub 仓库提交时间文件 + 监控页面

export default {
  async scheduled(event, env, ctx) {
    const repos = getRepoConfigs(env);
    const forceUpdate = env.FORCE !== 'false';
    
    console.log(`Found ${repos.length} repositories to update`);
    console.log(`Force update mode: ${forceUpdate}`);
    
    let lastUpdateTimes = {};
    if (env.STATUS_KV) {
      const cached = await env.STATUS_KV.get('last_update_times');
      if (cached) lastUpdateTimes = JSON.parse(cached);
    }
    
    const results = await Promise.allSettled(
      repos.map(repo => updateRepo(repo, forceUpdate, false, lastUpdateTimes))
    );
    
    const newUpdateTimes = {};
    results.forEach((result, index) => {
      const repoKey = `repo_${repos[index].index}`;
      if (result.status === 'fulfilled' && !result.value.skipped && !result.value.rateLimited) {
        newUpdateTimes[repoKey] = new Date().toISOString();
      } else if (lastUpdateTimes[repoKey]) {
        newUpdateTimes[repoKey] = lastUpdateTimes[repoKey];
      }
    });
    
    const statusData = results.map((result, index) => ({
      repo: repos[index].repo,
      weburl: repos[index].weburl,
      name: repos[index].name,
      index: repos[index].index,
      status: result.status === 'fulfilled' ? 'success' : 'failed',
      time: new Date().toISOString(),
      message: result.status === 'fulfilled' ? result.value.message : result.reason?.message || 'Unknown error',
      skipped: result.status === 'fulfilled' ? result.value.skipped : false,
      rateLimited: result.status === 'fulfilled' ? result.value.rateLimited : false
    }));
    
    if (env.STATUS_KV) {
      await env.STATUS_KV.put('latest_status', JSON.stringify(statusData));
      await env.STATUS_KV.put('last_update_times', JSON.stringify(newUpdateTimes));
    }
    
    await sendTelegramNotifications(statusData, env);
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        console.log(`✔ Repo ${index + 1} updated successfully`);
      } else {
        console.error(`✗ Repo ${index + 1} failed:`, result.reason);
      }
    });
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    if (env.PSWD) {
      const authResult = checkAuth(request, env.PSWD);
      if (authResult) return authResult;
    }
    
    if (url.pathname === '/' || url.pathname === '/status') {
      return new Response(getStatusHTML(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    
    if (url.pathname === '/api/status') {
      let statusData = [];
      if (env.STATUS_KV) {
        const cached = await env.STATUS_KV.get('latest_status');
        if (cached) statusData = JSON.parse(cached);
      }
      return new Response(JSON.stringify(statusData), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    
    if (url.pathname === '/api/trigger') {
      const repos = getRepoConfigs(env);
      if (repos.length === 0) {
        return new Response(JSON.stringify({ error: 'No repositories configured' }), { 
          status: 400, headers: { 'Content-Type': 'application/json' }
        });
      }
      
      const results = await Promise.allSettled(
        repos.map(repo => updateRepo(repo, false, true, {}))
      );
      
      let lastUpdateTimes = {};
      if (env.STATUS_KV) {
        const cached = await env.STATUS_KV.get('last_update_times');
        if (cached) lastUpdateTimes = JSON.parse(cached);
      }
      
      const newUpdateTimes = { ...lastUpdateTimes };
      results.forEach((result, index) => {
        const repoKey = `repo_${repos[index].index}`;
        if (result.status === 'fulfilled' && !result.value.skipped) {
          newUpdateTimes[repoKey] = new Date().toISOString();
        }
      });
      
      const statusData = results.map((result, index) => ({
        repo: repos[index].repo,
        weburl: repos[index].weburl,
        name: repos[index].name,
        index: repos[index].index,
        status: result.status === 'fulfilled' ? 'success' : 'failed',
        time: new Date().toISOString(),
        message: result.status === 'fulfilled' ? result.value.message : result.reason?.message || 'Unknown error',
        skipped: result.status === 'fulfilled' ? result.value.skipped : false,
        rateLimited: false
      }));
      
      if (env.STATUS_KV) {
        await env.STATUS_KV.put('latest_status', JSON.stringify(statusData));
        await env.STATUS_KV.put('last_update_times', JSON.stringify(newUpdateTimes));
      }
      
      await sendTelegramNotifications(statusData, env);
      
      return new Response(JSON.stringify(statusData), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    
    return new Response('Not Found', { status: 404 });
  }
};

async function sendTelegramNotifications(statusData, env) {
  if (!env.TG) return;
  
  const tgConfig = env.TG.trim().split(/\s+/);
  if (tgConfig.length !== 2) {
    console.error('TG format error: expected "chat_id token"');
    return;
  }
  
  const [chatId, token] = tgConfig;
  const failures = statusData.filter(item => item.status === 'failed' && !item.skipped && !item.rateLimited);
  
  if (failures.length === 0) return;
  
  for (const failure of failures) {
    const repoDisplay = failure.name || failure.repo;
    let weburlText = '';
    if (failure.weburl) {
      const urls = failure.weburl.split(',').map(url => url.trim()).filter(url => url);
      if (urls.length === 1) {
        weburlText = `🌐 网址: ${urls[0]}`;
      } else if (urls.length > 1) {
        weburlText = `🌐 网址:\n${urls.map((url, i) => `  ${i + 1}. ${url}`).join('\n')}`;
      }
    }
    
    const message = `❌ GitHub 提交失败\n\n📦 仓库: ${repoDisplay}\n🔢 编号: GITHUB${failure.index}\n⏰ 时间: ${new Date(failure.time).toLocaleString('zh-CN')}\n💬 错误: ${failure.message}\n${weburlText}`;

    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
      });
      if (!response.ok) {
        const error = await response.text();
        console.error(`Telegram notification failed for ${repoDisplay}:`, error);
      }
    } catch (error) {
      console.error(`Telegram notification error for ${repoDisplay}:`, error.message);
    }
  }
}

function checkAuth(request, password) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return new Response('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="GitHub Monitor", charset="UTF-8"', 'Content-Type': 'text/html; charset=utf-8' },
      body: getLoginHTML()
    });
  }
  
  const base64Credentials = authHeader.slice(6);
  const credentials = atob(base64Credentials);
  const [username, pass] = credentials.split(':');
  
  if (pass !== password) {
    return new Response('Invalid credentials', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="GitHub Monitor", charset="UTF-8"', 'Content-Type': 'text/html; charset=utf-8' },
      body: getLoginHTML()
    });
  }
  return null;
}

function getRepoConfigs(env) {
  const repos = [];
  let index = 1;
  
  while (true) {
    const key = `GITHUB${index}`;
    const config = env[key];
    if (!config) break;
    
    try {
      const parsed = JSON.parse(config);
      if (parsed.token && parsed.repo) {
        repos.push({
          token: parsed.token,
          repo: parsed.repo,
          weburl: parsed.weburl || null,
          name: parsed.name || null,
          index: index
        });
      } else {
        console.warn(`${key} missing token or repo field`);
      }
    } catch (e) {
      console.error(`Failed to parse ${key}:`, e.message);
    }
    index++;
  }
  return repos;
}

async function checkWebUrl(weburl) {
  if (!weburl) return { accessible: false, reason: 'No weburl configured' };
  
  const urls = weburl.split(',').map(url => url.trim()).filter(url => url);
  if (urls.length === 0) return { accessible: false, reason: 'No valid weburl configured' };
  
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' });
        clearTimeout(timeoutId);
        const accessible = response.status >= 200 && response.status < 400;
        return { url, accessible, status: response.status, reason: accessible ? 'Website is accessible' : `HTTP ${response.status}` };
      } catch (error) {
        return { url, accessible: false, reason: error.name === 'AbortError' ? 'Request timeout' : error.message };
      }
    })
  );
  
  const accessibleResults = results.filter(r => r.accessible);
  if (accessibleResults.length > 0) {
    return { accessible: true, status: accessibleResults[0].status, reason: `${accessibleResults.length}/${urls.length} website(s) accessible`, details: results };
  }
  return { accessible: false, reason: `All ${urls.length} website(s) inaccessible`, details: results };
}

async function updateRepo(config, checkUrl = true, manualTrigger = false, lastUpdateTimes = {}) {
  const { token, repo, weburl, name, index } = config;
  const [owner, repoName] = repo.split('/');
  
  if (!owner || !repoName) throw new Error(`Invalid repo format: ${repo}. Expected: owner/repo`);
  
  if (!manualTrigger) {
    const repoKey = `repo_${index}`;
    const lastUpdate = lastUpdateTimes[repoKey];
    if (lastUpdate) {
      const lastUpdateTime = new Date(lastUpdate);
      const now = new Date();
      const diffMinutes = (now - lastUpdateTime) / 1000 / 60;
      if (diffMinutes < 10) {
        const remainingMinutes = Math.ceil(10 - diffMinutes);
        console.log(`Repo ${index}: Rate limited, last update was ${Math.floor(diffMinutes)} minutes ago`);
        return { success: true, skipped: false, rateLimited: true, message: `Rate limited: Please wait ${remainingMinutes} more minute(s)`, time: new Date().toISOString() };
      }
    }
  }
  
  if (checkUrl && weburl) {
    const urls = weburl.split(',').map(url => url.trim()).filter(url => url);
    console.log(`Repo ${index}: Checking ${urls.length} weburl(s)`);
    const urlCheck = await checkWebUrl(weburl);
    if (urlCheck.accessible) {
      console.log(`Repo ${index}: Website(s) accessible, skipping update`);
      return { success: true, skipped: true, rateLimited: false, message: `Skipped: ${urlCheck.reason}`, time: new Date().toISOString() };
    }
    console.log(`Repo ${index}: Website(s) not accessible (${urlCheck.reason}), proceeding with update`);
  }
  
  const branch = await getDefaultBranch(owner, repoName, token);
  const latestCommitSha = await getLatestCommit(owner, repoName, branch, token);
  const treeSha = await getTreeSha(owner, repoName, latestCommitSha, token);
  const currentTime = new Date().toISOString();
  const blobSha = await createBlob(owner, repoName, currentTime, token);
  const newTreeSha = await createTree(owner, repoName, treeSha, blobSha, token);
  const newCommitSha = await createCommit(owner, repoName, newTreeSha, latestCommitSha, currentTime, token);
  await updateRef(owner, repoName, branch, newCommitSha, token);
  console.log(`Repo ${index} (${repo}) updated at ${currentTime}`);
  const triggerType = manualTrigger ? 'manual trigger' : 'website check failed';
  return { success: true, skipped: false, rateLimited: false, message: `Commit successful (${triggerType})`, time: currentTime };
}

async function githubApi(endpoint, token, options = {}) {
  const url = `https://api.github.com${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Cloudflare-Worker', ...options.headers }
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${error}`);
  }
  return response.json();
}

async function getDefaultBranch(owner, repo, token) {
  const data = await githubApi(`/repos/${owner}/${repo}`, token);
  return data.default_branch;
}

async function getLatestCommit(owner, repo, branch, token) {
  const data = await githubApi(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token);
  return data.object.sha;
}

async function getTreeSha(owner, repo, commitSha, token) {
  const data = await githubApi(`/repos/${owner}/${repo}/git/commits/${commitSha}`, token);
  return data.tree.sha;
}

async function createBlob(owner, repo, content, token) {
  const data = await githubApi(`/repos/${owner}/${repo}/git/blobs`, token, {
    method: 'POST',
    body: JSON.stringify({ content: content, encoding: 'utf-8' })
  });
  return data.sha;
}

async function createTree(owner, repo, baseTreeSha, blobSha, token) {
  const data = await githubApi(`/repos/${owner}/${repo}/git/trees`, token, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: [{ path: 'time.txt', mode: '100644', type: 'blob', sha: blobSha }] })
  });
  return data.sha;
}

async function createCommit(owner, repo, treeSha, parentSha, time, token) {
  const data = await githubApi(`/repos/${owner}/${repo}/git/commits`, token, {
    method: 'POST',
    body: JSON.stringify({ message: `Update time.txt - ${time}`, tree: treeSha, parents: [parentSha] })
  });
  return data.sha;
}

async function updateRef(owner, repo, branch, commitSha, token) {
  await githubApi(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commitSha, force: false })
  });
}

function getLoginHTML() {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录-GitHub监控</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.login-container{background:#fff;border-radius:16px;padding:40px;box-shadow:0 10px 40px rgba(0,0,0,.2);max-width:400px;width:100%;text-align:center}.lock-icon{width:64px;height:64px;margin:0 auto 24px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:32px}h1{color:#2d3748;font-size:24px;margin-bottom:8px}.subtitle{color:#718096;font-size:14px;margin-bottom:32px}.message{background:#fff5f5;border:1px solid #feb2b2;color:#c53030;padding:12px;border-radius:8px;font-size:14px;margin-bottom:24px}.info{background:#ebf8ff;border:1px solid #90cdf4;color:#2c5282;padding:12px;border-radius:8px;font-size:13px;text-align:left;line-height:1.6}</style></head><body><div class="login-container"><div class="lock-icon">🔒</div><h1>需要身份验证</h1><p class="subtitle">请输入密码访问监控页面</p><div class="message">认证失败,请检查密码是否正确</div><div class="info"><strong>💡 提示:</strong><br>• 用户名可以输入任意内容<br>• 密码为环境变量 PSWD 设置的值<br>• 浏览器会记住您的登录状态</div></div></body></html>`;
}

function getStatusHTML(){return`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GitHub仓库提交监控</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;padding:20px}.container{max-width:1200px;margin:0 auto}.header{background:#fff;border-radius:12px;padding:30px;margin-bottom:20px;box-shadow:0 4px 6px rgba(0,0,0,.1)}h1{color:#2d3748;font-size:28px;margin-bottom:10px}.subtitle{color:#718096;font-size:14px}.controls{display:flex;gap:10px;margin-top:20px}button{background:#667eea;color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-size:14px;font-weight:500;transition:all .3s}button:hover{background:#5568d3;transform:translateY(-2px);box-shadow:0 4px 8px rgba(102,126,234,.4)}button:disabled{background:#cbd5e0;cursor:not-allowed;transform:none}.status-grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(350px,1fr))}.status-card{background:#fff;border-radius:12px;padding:24px;box-shadow:0 4px 6px rgba(0,0,0,.1);transition:transform .3s}.status-card:hover{transform:translateY(-4px);box-shadow:0 8px 12px rgba(0,0,0,.15)}.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}.repo-name{font-size:16px;font-weight:600;color:#2d3748;font-family:'Courier New',monospace;letter-spacing:-.5px}.status-badge{padding:4px 12px;border-radius:12px;font-size:12px;font-weight:600;text-transform:uppercase}.status-success{background:#c6f6d5;color:#22543d}.status-failed{background:#fed7d7;color:#742a2a}.status-skipped{background:#fef5e7;color:#975a16}.status-ratelimited{background:#e8f4fd;color:#1e5a8e}.status-unknown{background:#e2e8f0;color:#4a5568}.card-body{border-top:1px solid #e2e8f0;padding-top:16px}.info-row{display:flex;justify-content:space-between;margin-bottom:8px;font-size:14px}.info-label{color:#718096;font-weight:500}.info-value{color:#2d3748;font-weight:600}.weburl{margin-top:8px;padding:8px;background:#f7fafc;border-radius:4px;font-size:12px;color:#4a5568;word-break:break-all;font-family:'Courier New',monospace}.message{margin-top:12px;padding:12px;background:#f7fafc;border-radius:6px;font-size:13px;color:#4a5568;word-break:break-word}.loading{text-align:center;padding:60px;color:#fff;font-size:18px}.empty-state{background:#fff;border-radius:12px;padding:60px;text-align:center;color:#718096}.empty-state svg{width:64px;height:64px;margin-bottom:16px;opacity:.5}.last-updated{text-align:center;color:#fff;margin-top:20px;font-size:14px;opacity:.9}@media(max-width:768px){.status-grid{grid-template-columns:1fr}.controls{flex-direction:column}button{width:100%}}</style></head><body><div class="container"><div class="header"><h1>📊 GitHub仓库提交监控</h1><p class="subtitle">实时监控自动提交任务状态</p><div class="controls"><button onclick="refreshStatus()">🔄 刷新状态</button><button onclick="triggerNow()"id="triggerBtn">▶️ 立即执行(强制)</button></div></div><div id="content"class="loading"><div>⏳ 加载中...</div></div><div class="last-updated"id="lastUpdated"></div></div><script>function maskRepo(e){return e&&e.length>4?"*".repeat(e.length-4)+e.slice(-4):e}function formatTime(e){if(!e)return"-";const t=new Date(e),a=new Date,s=a-t,n=Math.floor(s/1e3),i=Math.floor(n/60),o=Math.floor(i/60),d=Math.floor(o/24);let r="";r=d>0?d+" 天前":o>0?o+" 小时前":i>0?i+" 分钟前":"刚刚";const l=t.toLocaleString("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"});return\`\${l} (\${r})\`}async function loadStatus(){try{const e=await fetch("/api/status"),t=await e.json(),a=document.getElementById("content");if(0===t.length)return void(a.innerHTML=\`<div class="empty-state"><svg fill="none"stroke="currentColor"viewBox="0 0 24 24"><path stroke-linecap="round"stroke-linejoin="round"stroke-width="2"d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path></svg><h3>暂无数据</h3><p>尚未执行过任何任务,请点击"立即执行"按钮开始</p></div>\`);a.className="status-grid",a.innerHTML=t.map(e=>{let t,a;return t=e.rateLimited?(a="status-ratelimited","⏱ 限频"):e.skipped?(a="status-skipped","⊘ 跳过"):"success"===e.status?(a="status-success","✓ 成功"):(a="status-failed","✗ 失败"),\`<div class="status-card"><div class="card-header"><div class="repo-name">\${e.name||maskRepo(e.repo)}</div><div class="status-badge \${a}">\${t}</div></div><div class="card-body"><div class="info-row"><span class="info-label">仓库编号</span><span class="info-value">GITHUB\${e.index}</span></div><div class="info-row"><span class="info-label">最后更新</span><span class="info-value">\${formatTime(e.time)}</span></div>\${e.weburl?\`<div class="weburl">🌐 \${e.weburl.split(",").map(e=>e.trim()).filter(e=>e).join(" | ")}</div>\`:""}\${e.message?\`<div class="message">\${e.message}</div>\`:""}</div></div>\`}).join(""),document.getElementById("lastUpdated").textContent="页面更新时间: "+new Date().toLocaleString("zh-CN")}catch(e){document.getElementById("content").innerHTML=\`<div class="empty-state"><h3>加载失败</h3><p>\${e.message}</p></div>\`}}async function triggerNow(){const e=document.getElementById("triggerBtn");e.disabled=!0,e.textContent="⏳ 执行中...";try{await fetch("/api/trigger"),await loadStatus(),e.textContent="✓ 执行完成",setTimeout(()=>{e.textContent="▶️ 立即执行(强制)",e.disabled=!1},2e3)}catch(t){alert("执行失败: "+t.message),e.textContent="▶️ 立即执行(强制)",e.disabled=!1}}function refreshStatus(){loadStatus()}loadStatus(),setInterval(loadStatus,3e4)</script></body></html>`;}
