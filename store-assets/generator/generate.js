const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const locales = {
  zh: {
    title1: '一次装好',
    title2: '全部',
    titleHighlight: '播放器魔法',
    features: [
      '全局只播放一个 YouTube 标签',
      '自动高清 + 帧率（最高 4K / 60fps）',
      '禁用画中画 · 默认影院模式',
      '自动播放控制 · 缓冲/速度 HUD'
    ],
    footer: '本地运行 · 零数据收集 · 无需登录'
  },
  en: {
    title1: 'Install once',
    title2: 'Get all',
    titleHighlight: 'player magic',
    features: [
      'Play only one YouTube tab at a time',
      'Auto HD & framerate (up to 4K / 60fps)',
      'Disable PiP · Default theater mode',
      'Autoplay control · Buffer & Speed HUD'
    ],
    footer: 'Runs locally · Zero data collection · No login'
  },
  ja: {
    title1: '一度のインストールで',
    title2: 'すべての',
    titleHighlight: 'プレイヤー魔法を',
    features: [
      'YouTubeタブは1つだけ再生',
      '自動HD & フレームレート (最大 4K / 60fps)',
      'PiP 無効化 · デフォルトシアターモード',
      '自動再生コントロール · バッファ&速度 HUD'
    ],
    footer: 'ローカル実行 · データ収集ゼロ · ログイン不要'
  },
  ko: {
    title1: '한 번의 설치로',
    title2: '모든',
    titleHighlight: '플레이어 마법을',
    features: [
      '단 하나의 YouTube 탭만 재생',
      '자동 HD & 프레임 속도 (최대 4K / 60fps)',
      'PIP 비활성화 · 기본 영화관 모드',
      '자동 재생 제어 · 버퍼 & 속도 HUD'
    ],
    footer: '로컬 실행 · 데이터 수집 제로 · 로그인 불필요'
  }
};

const htmlTemplate = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=Noto+Sans+SC:wght@400;700;900&family=Noto+Sans+JP:wght@400;700;900&family=Noto+Sans+KR:wght@400;700;900&display=swap" rel="stylesheet">
  <style>
    body {
      margin: 0;
      padding: 0;
      width: 1280px;
      height: 800px;
      /* Original background is very dark reddish black */
      background: #0f0a0a;
      background: radial-gradient(circle at 65% 50%, #2f1214 0%, #15090a 45%, #0d0c0f 80%);
      font-family: 'Inter', 'Noto Sans SC', 'Noto Sans JP', 'Noto Sans KR', sans-serif;
      color: white;
      display: flex;
      box-sizing: border-box;
      overflow: hidden;
    }
    
    .left-panel {
      flex: 1;
      padding: 100px 60px 80px 80px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 50px;
    }
    
    .logo-img {
      width: 36px;
      height: 36px;
    }

    .brand-name {
      font-size: 38px;
      font-weight: 800;
      letter-spacing: -0.5px;
    }

    .hero-title {
      font-size: 56px;
      font-weight: 900;
      line-height: 1.3;
      margin-bottom: 40px;
      letter-spacing: -1px;
    }
    
    .hero-title .highlight {
      color: #f63c3c;
    }

    .features {
      list-style: none;
      padding: 0;
      margin: 0 0 50px 0;
    }

    .feature-item {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 24px;
      color: #f1f1f1;
    }

    .check-icon {
      width: 28px;
      height: 28px;
      background: rgba(246, 60, 60, 0.15);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #f63c3c;
    }
    
    .check-icon svg {
      width: 16px;
      height: 16px;
    }

    .footer {
      margin-top: auto;
      font-size: 18px;
      color: #888;
      font-weight: 400;
      letter-spacing: 0.5px;
    }

    .right-panel {
      width: 580px;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 60px;
    }

    .mockup-container {
      width: 440px;
      background: #1e1e1e;
      border-radius: 16px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transform: translateY(10px);
    }
    
    .mockup-header {
      padding: 20px 24px 16px 24px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    
    .mockup-header .logo-img {
      width: 20px;
      height: 20px;
    }
    
    .mockup-header .brand-name {
      font-size: 18px;
      font-weight: 700;
    }

    .mockup-body {
      background-image: url('file://${path.resolve(__dirname, '../options.png')}');
      background-size: cover;
      background-position: top center;
      width: 100%;
      height: 560px; /* Adjust to fit the options.png */
    }
  </style>
</head>
<body>
  <div class="left-panel">
    <div class="brand">
      <!-- YouTube style play button as placeholder logo -->
      <svg class="logo-img" viewBox="0 0 24 24" fill="#f63c3c">
        <path d="M21.582 6.186c-.23-.86-.908-1.538-1.768-1.768C18.253 4 12 4 12 4s-6.253 0-7.814.418c-.86.23-1.538.908-1.768 1.768C2 7.747 2 12 2 12s0 4.253.418 5.814c.23.86.908 1.538 1.768 1.768C5.747 20 12 20 12 20s6.253 0 7.814-.418c.86-.23 1.538-.908 1.768-1.768C22 16.253 22 12 22 12s0-4.253-.418-5.814zM9.996 15.005l.005-6 5.207 3.005-5.212 2.995z"/>
      </svg>
      <div class="brand-name">TubeWizard</div>
    </div>

    <div class="hero-title">
      <div id="t1"></div>
      <div style="margin-top: 10px"><span id="t2"></span> <span class="highlight" id="tH"></span></div>
    </div>

    <ul class="features" id="features">
      <!-- Injected by JS -->
    </ul>

    <div class="footer" id="footer"></div>
  </div>
  
  <div class="right-panel">
    <div class="mockup-container">
      <div class="mockup-header">
        <svg class="logo-img" viewBox="0 0 24 24" fill="#f63c3c">
          <path d="M21.582 6.186c-.23-.86-.908-1.538-1.768-1.768C18.253 4 12 4 12 4s-6.253 0-7.814.418c-.86.23-1.538.908-1.768 1.768C2 7.747 2 12 2 12s0 4.253.418 5.814c.23.86.908 1.538 1.768 1.768C5.747 20 12 20 12 20s6.253 0 7.814-.418c.86-.23 1.538-.908 1.768-1.768C22 16.253 22 12 22 12s0-4.253-.418-5.814zM9.996 15.005l.005-6 5.207 3.005-5.212 2.995z"/>
        </svg>
        <div class="brand-name">TubeWizard</div>
      </div>
      <div class="mockup-body"></div>
    </div>
  </div>

  <script>
    function setContent(data) {
      document.getElementById('t1').textContent = data.title1;
      document.getElementById('t2').textContent = data.title2;
      document.getElementById('tH').textContent = data.titleHighlight;
      document.getElementById('footer').textContent = data.footer;
      
      const featuresUl = document.getElementById('features');
      featuresUl.innerHTML = '';
      data.features.forEach(f => {
        const li = document.createElement('li');
        li.className = 'feature-item';
        li.innerHTML = \`
          <div class="check-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          \${f}
        \`;
        featuresUl.appendChild(li);
      });
    }
  </script>
</body>
</html>
`;

(async () => {
  fs.writeFileSync('template.html', htmlTemplate);

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-web-security']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  
  // Create an absolute URL for the template
  const fileUrl = 'file://' + path.resolve(__dirname, 'template.html');
  await page.goto(fileUrl, { waitUntil: 'networkidle0' });

  for (const [lang, data] of Object.entries(locales)) {
    console.log(\`Generating \${lang}...\`);
    await page.evaluate((content) => {
      window.setContent(content);
    }, data);
    
    // wait a moment for fonts to potentially render better
    await new Promise(r => setTimeout(r, 500));
    
    await page.screenshot({ path: \`../store-screenshot-1280x800-\${lang}.png\` });
    console.log(\`Saved store-screenshot-1280x800-\${lang}.png\`);
  }

  await browser.close();
  console.log('Done.');
})();
