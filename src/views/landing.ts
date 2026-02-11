export function renderLandingPage(appUrl: string = 'https://cron-pulse.com'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CronPulse — Cron Job Monitoring Made Simple</title>
  <meta name="description" content="Monitor your cron jobs with a single curl. Get instant email, Slack, and webhook alerts when they fail. Open source. Free for up to 10 checks.">
  <link rel="canonical" href="${appUrl}">
  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${appUrl}">
  <meta property="og:title" content="CronPulse — Know When Your Cron Jobs Fail">
  <meta property="og:description" content="Add one curl to your cron job. Get alerted via email, Slack, or webhook when it stops. Open source, runs on Cloudflare's edge. Free tier available.">
  <meta property="og:site_name" content="CronPulse">
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="CronPulse — Know When Your Cron Jobs Fail">
  <meta name="twitter:description" content="Add one curl to your cron job. Get alerted via email, Slack, or webhook when it stops. Open source, runs on Cloudflare's edge.">
  <!-- JSON-LD Structured Data -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "CronPulse",
    "applicationCategory": "DeveloperApplication",
    "operatingSystem": "Web",
    "url": "${appUrl}",
    "description": "Open source cron job monitoring. Get email, Slack, and webhook alerts when your cron jobs fail.",
    "isAccessibleForFree": true,
    "license": "https://www.gnu.org/licenses/agpl-3.0.html",
    "screenshot": "${appUrl}/og-image.png",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD",
      "description": "Free tier with 10 checks"
    },
    "creator": {
      "@type": "Organization",
      "name": "CronPulse",
      "url": "${appUrl}"
    }
  }
  </script>
  <!-- FAQPage structured data for rich search results -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "What is CronPulse?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "CronPulse is an open source cron job monitoring service. You add a single curl command to the end of your cron job, and CronPulse alerts you via email, Slack, or webhook if it stops running on schedule."
        }
      },
      {
        "@type": "Question",
        "name": "How does CronPulse work?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Create a check with an expected interval (e.g. every hour). CronPulse gives you a unique ping URL. Add 'curl -fsS https://cron-pulse.com/ping/YOUR_ID' to the end of your cron job. If the ping doesn't arrive within the expected interval plus grace period, CronPulse sends you an alert."
        }
      },
      {
        "@type": "Question",
        "name": "Is CronPulse free?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Yes! CronPulse has a free tier with up to 10 checks, email alerts, and 7-day history. Paid plans start at $5/month for more checks and additional notification channels like Slack and webhooks."
        }
      },
      {
        "@type": "Question",
        "name": "Is CronPulse open source?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Yes, CronPulse is fully open source under the AGPL-3.0 license. The source code is available on GitHub at github.com/nicepkg/cronpulse. You can self-host it on Cloudflare Workers."
        }
      },
      {
        "@type": "Question",
        "name": "What notification channels does CronPulse support?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "CronPulse supports email alerts (all plans), Slack incoming webhooks, and custom webhook notifications. Recovery notifications are also sent when a check comes back online."
        }
      }
    ]
  }
  </script>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-white">
  <!-- Nav -->
  <nav class="max-w-5xl mx-auto px-4 py-4">
    <div class="flex items-center justify-between">
      <span class="text-xl font-bold">CronPulse</span>
      <!-- Desktop nav -->
      <div class="hidden md:flex items-center gap-4">
        <a href="https://github.com/nicepkg/cronpulse" class="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1" target="_blank" rel="noopener">
          <svg class="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
          GitHub
        </a>
        <a href="#pricing" class="text-sm text-gray-600 hover:text-gray-900">Pricing</a>
        <a href="/docs" class="text-sm text-gray-600 hover:text-gray-900">Docs</a>
        <a href="/blog" class="text-sm text-gray-600 hover:text-gray-900">Blog</a>
        <a href="/auth/login" class="text-sm text-gray-600 hover:text-gray-900">Login</a>
        <a href="/auth/login" class="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">
          Get Started Free
        </a>
      </div>
      <!-- Mobile hamburger -->
      <div class="md:hidden flex items-center gap-3">
        <a href="/auth/login" class="bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-blue-700">Get Started</a>
        <button onclick="document.getElementById('mobile-nav').classList.toggle('hidden')" class="p-1 text-gray-600" aria-label="Menu">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
      </div>
    </div>
    <!-- Mobile menu -->
    <div id="mobile-nav" class="hidden md:hidden mt-3 pb-3 border-t pt-3 space-y-2">
      <a href="https://github.com/nicepkg/cronpulse" class="block text-sm text-gray-600 hover:text-gray-900 py-1" target="_blank" rel="noopener">GitHub</a>
      <a href="#pricing" class="block text-sm text-gray-600 hover:text-gray-900 py-1">Pricing</a>
      <a href="/docs" class="block text-sm text-gray-600 hover:text-gray-900 py-1">Docs</a>
      <a href="/blog" class="block text-sm text-gray-600 hover:text-gray-900 py-1">Blog</a>
      <a href="/auth/login" class="block text-sm text-gray-600 hover:text-gray-900 py-1">Login</a>
    </div>
  </nav>

  <!-- Open Source Banner -->
  <div class="bg-green-50 border-b border-green-200">
    <div class="max-w-5xl mx-auto px-4 py-2 text-center">
      <p class="text-green-800 text-sm">Open Source &amp; Free — Email, Slack, and webhook alerts are live. <a href="https://github.com/nicepkg/cronpulse" class="underline font-medium hover:text-green-900" target="_blank" rel="noopener">Star us on GitHub</a></p>
    </div>
  </div>

  <!-- Hero -->
  <section class="max-w-3xl mx-auto px-4 pt-20 pb-16 text-center">
    <a href="https://github.com/nicepkg/cronpulse" target="_blank" rel="noopener"
       class="inline-flex items-center gap-2 bg-gray-900 text-white text-xs font-medium px-3 py-1 rounded-full mb-6 hover:bg-gray-700 transition-colors">
      <svg class="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      Open Source &mdash; AGPL-3.0
    </a>
    <h1 class="text-4xl md:text-5xl font-bold text-gray-900 leading-tight">
      Know when your cron jobs fail.
    </h1>
    <p class="text-lg text-gray-600 mt-4 max-w-xl mx-auto">
      Add one line to your script. Get alerted when it stops running. That's it.
    </p>
    <div class="mt-8 bg-gray-900 rounded-lg p-4 max-w-md mx-auto text-left">
      <code class="text-green-400 text-sm">
        <span class="text-gray-500"># Add this to the end of your cron job:</span><br>
        curl -fsS ${appUrl}/ping/<span class="text-yellow-300">YOUR_CHECK_ID</span>
      </code>
    </div>
    <div class="mt-8 flex justify-center gap-4">
      <a href="/auth/login" class="bg-blue-600 text-white px-6 py-3 rounded-md font-medium hover:bg-blue-700">
        Start Monitoring Free
      </a>
    </div>
    <p class="text-sm text-gray-400 mt-3">Free for up to 10 checks. No credit card required.</p>
  </section>

  <!-- How it works -->
  <section class="bg-gray-50 py-16">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-bold text-center mb-12">How it works</h2>
      <div class="grid md:grid-cols-3 gap-8">
        <div class="text-center">
          <div class="text-3xl mb-3">1</div>
          <h3 class="font-semibold mb-2">Create a check</h3>
          <p class="text-sm text-gray-600">Set the expected interval and grace period. Get a unique ping URL.</p>
        </div>
        <div class="text-center">
          <div class="text-3xl mb-3">2</div>
          <h3 class="font-semibold mb-2">Add one line</h3>
          <p class="text-sm text-gray-600">Add a curl to the end of your cron job. Done in 10 seconds.</p>
        </div>
        <div class="text-center">
          <div class="text-3xl mb-3">3</div>
          <h3 class="font-semibold mb-2">Get alerted</h3>
          <p class="text-sm text-gray-600">If your job stops running, we'll notify you via email, Slack, or webhook.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Features -->
  <section class="py-16">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-bold text-center mb-12">Everything you need to sleep soundly</h2>
      <div class="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
        <div class="bg-white border rounded-lg p-5">
          <div class="text-2xl mb-2">&#9889;</div>
          <h3 class="font-semibold mb-1">Instant alerts</h3>
          <p class="text-sm text-gray-600">Email, Slack, and webhook notifications when checks go down or recover.</p>
        </div>
        <div class="bg-white border rounded-lg p-5">
          <div class="text-2xl mb-2">&#128736;</div>
          <h3 class="font-semibold mb-1">Maintenance windows</h3>
          <p class="text-sm text-gray-600">Schedule one-time or recurring maintenance. No false alarms during planned downtime.</p>
        </div>
        <div class="bg-white border rounded-lg p-5">
          <div class="text-2xl mb-2">&#128200;</div>
          <h3 class="font-semibold mb-1">Health scores</h3>
          <p class="text-sm text-gray-600">See check health at a glance: uptime percentage, alert frequency, and overall score.</p>
        </div>
        <div class="bg-white border rounded-lg p-5">
          <div class="text-2xl mb-2">&#127760;</div>
          <h3 class="font-semibold mb-1">Global edge network</h3>
          <p class="text-sm text-gray-600">Runs on Cloudflare's 300+ locations. Sub-5ms ping response time.</p>
        </div>
        <div class="bg-white border rounded-lg p-5">
          <div class="text-2xl mb-2">&#128274;</div>
          <h3 class="font-semibold mb-1">Open source</h3>
          <p class="text-sm text-gray-600">Full source code on GitHub. Self-host on your own Cloudflare account if you prefer.</p>
        </div>
        <div class="bg-white border rounded-lg p-5">
          <div class="text-2xl mb-2">&#128268;</div>
          <h3 class="font-semibold mb-1">REST API</h3>
          <p class="text-sm text-gray-600">Manage checks, incidents, and alerts programmatically. Perfect for CI/CD.</p>
        </div>
        <div class="bg-white border rounded-lg p-5">
          <div class="text-2xl mb-2">&#128276;</div>
          <h3 class="font-semibold mb-1">Recovery notifications</h3>
          <p class="text-sm text-gray-600">Know when a check recovers, not just when it goes down.</p>
        </div>
        <div class="bg-white border rounded-lg p-5">
          <div class="text-2xl mb-2">&#127991;</div>
          <h3 class="font-semibold mb-1">Status badges</h3>
          <p class="text-sm text-gray-600">Embed live status and uptime badges in your README or status page.</p>
        </div>
        <div class="bg-white border rounded-lg p-5">
          <div class="text-2xl mb-2">&#128230;</div>
          <h3 class="font-semibold mb-1">Import &amp; export</h3>
          <p class="text-sm text-gray-600">Bulk import checks from JSON. Export your config anytime. No lock-in.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Social Proof / Use Cases -->
  <section class="bg-gray-50 py-16">
    <div class="max-w-4xl mx-auto px-4">
      <h2 class="text-2xl font-bold text-center mb-4">Built for developers who run things in production</h2>
      <p class="text-center text-gray-600 mb-12">Whether it's a nightly backup, a payment processor, or a data pipeline &mdash; if it runs on a schedule, CronPulse watches it.</p>
      <div class="grid md:grid-cols-3 gap-6">
        <div class="bg-white rounded-lg border p-5">
          <div class="bg-gray-900 rounded-md p-3 mb-4 text-left">
            <code class="text-green-400 text-xs">
              <span class="text-gray-500"># Database backup</span><br>
              0 2 * * * pg_dump ... &amp;&amp; \\<br>
              &nbsp; curl -fsS ${appUrl}/ping/abc
            </code>
          </div>
          <h3 class="font-semibold text-sm">Database Backups</h3>
          <p class="text-xs text-gray-500 mt-1">Know instantly if your nightly backup stops running.</p>
        </div>
        <div class="bg-white rounded-lg border p-5">
          <div class="bg-gray-900 rounded-md p-3 mb-4 text-left">
            <code class="text-green-400 text-xs">
              <span class="text-gray-500"># Payment sync</span><br>
              */15 * * * * node sync.js &amp;&amp; \\<br>
              &nbsp; curl -fsS ${appUrl}/ping/def
            </code>
          </div>
          <h3 class="font-semibold text-sm">Payment Processing</h3>
          <p class="text-xs text-gray-500 mt-1">Catch payment sync failures before customers notice.</p>
        </div>
        <div class="bg-white rounded-lg border p-5">
          <div class="bg-gray-900 rounded-md p-3 mb-4 text-left">
            <code class="text-green-400 text-xs">
              <span class="text-gray-500"># Data pipeline</span><br>
              0 * * * * python etl.py &amp;&amp; \\<br>
              &nbsp; curl -fsS ${appUrl}/ping/ghi
            </code>
          </div>
          <h3 class="font-semibold text-sm">Data Pipelines</h3>
          <p class="text-xs text-gray-500 mt-1">Ensure your ETL jobs complete on schedule, every time.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Pricing -->
  <section id="pricing" class="bg-gray-50 py-16">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-bold text-center mb-4">Simple pricing</h2>
      <p class="text-center text-gray-600 mb-12">Start free. Upgrade when you need more.</p>
      <div class="grid md:grid-cols-4 gap-4 max-w-4xl mx-auto">
        <!-- Free -->
        <div class="bg-white rounded-lg border p-6">
          <h3 class="font-semibold">Free</h3>
          <p class="text-3xl font-bold mt-2">$0</p>
          <p class="text-sm text-gray-500 mt-1">forever</p>
          <ul class="mt-4 space-y-2 text-sm text-gray-600">
            <li>10 checks</li>
            <li>5 min minimum interval</li>
            <li>Email alerts</li>
            <li>7 day history</li>
          </ul>
          <a href="/auth/login" class="block mt-6 text-center border rounded-md py-2 text-sm hover:bg-gray-50">Get Started</a>
        </div>
        <!-- Starter -->
        <div class="bg-white rounded-lg border-2 border-blue-500 p-6 relative">
          <span class="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-xs px-2 py-0.5 rounded-full">Popular</span>
          <h3 class="font-semibold">Starter</h3>
          <p class="text-3xl font-bold mt-2">$5<span class="text-lg font-normal text-gray-500">/mo</span></p>
          <ul class="mt-4 space-y-2 text-sm text-gray-600">
            <li>50 checks</li>
            <li>1 min minimum interval</li>
            <li>Email + Webhook + Slack</li>
            <li>30 day history</li>
          </ul>
          <a href="/auth/login" class="block mt-6 text-center bg-blue-600 text-white rounded-md py-2 text-sm hover:bg-blue-700">Start Free Trial</a>
        </div>
        <!-- Pro -->
        <div class="bg-white rounded-lg border p-6">
          <h3 class="font-semibold">Pro</h3>
          <p class="text-3xl font-bold mt-2">$15<span class="text-lg font-normal text-gray-500">/mo</span></p>
          <ul class="mt-4 space-y-2 text-sm text-gray-600">
            <li>200 checks</li>
            <li>1 min minimum interval</li>
            <li>All notifications</li>
            <li>90 day history</li>
            <li>API access</li>
          </ul>
          <a href="/auth/login" class="block mt-6 text-center border rounded-md py-2 text-sm hover:bg-gray-50">Get Started</a>
        </div>
        <!-- Business -->
        <div class="bg-white rounded-lg border p-6">
          <h3 class="font-semibold">Business</h3>
          <p class="text-3xl font-bold mt-2">$49<span class="text-lg font-normal text-gray-500">/mo</span></p>
          <ul class="mt-4 space-y-2 text-sm text-gray-600">
            <li>1,000 checks</li>
            <li>1 min minimum interval</li>
            <li>All notifications</li>
            <li>1 year history</li>
            <li>API access</li>
            <li>Priority support</li>
          </ul>
          <a href="/auth/login" class="block mt-6 text-center border rounded-md py-2 text-sm hover:bg-gray-50">Get Started</a>
        </div>
      </div>
    </div>
  </section>

  <!-- FAQ -->
  <section class="py-16">
    <div class="max-w-3xl mx-auto px-4">
      <h2 class="text-2xl font-bold text-center mb-8">Frequently Asked Questions</h2>
      <div class="space-y-3">
        <details class="bg-white border rounded-lg">
          <summary class="px-6 py-4 cursor-pointer font-medium text-gray-900 hover:text-blue-600">What is CronPulse?</summary>
          <div class="px-6 pb-4 text-sm text-gray-600">CronPulse is an open source cron job monitoring service. You add a single curl command to the end of your cron job, and CronPulse alerts you via email, Slack, or webhook if it stops running on schedule.</div>
        </details>
        <details class="bg-white border rounded-lg">
          <summary class="px-6 py-4 cursor-pointer font-medium text-gray-900 hover:text-blue-600">How does CronPulse work?</summary>
          <div class="px-6 pb-4 text-sm text-gray-600">Create a check with an expected interval (e.g. every hour). CronPulse gives you a unique ping URL. Add &lsquo;curl -fsS https://cron-pulse.com/ping/YOUR_ID&rsquo; to the end of your cron job. If the ping doesn&rsquo;t arrive within the expected interval plus grace period, CronPulse sends you an alert.</div>
        </details>
        <details class="bg-white border rounded-lg">
          <summary class="px-6 py-4 cursor-pointer font-medium text-gray-900 hover:text-blue-600">Is CronPulse free?</summary>
          <div class="px-6 pb-4 text-sm text-gray-600">Yes! CronPulse has a free tier with up to 10 checks, email alerts, and 7-day history. Paid plans start at $5/month for more checks and additional notification channels like Slack and webhooks.</div>
        </details>
        <details class="bg-white border rounded-lg">
          <summary class="px-6 py-4 cursor-pointer font-medium text-gray-900 hover:text-blue-600">Is CronPulse open source?</summary>
          <div class="px-6 pb-4 text-sm text-gray-600">Yes, CronPulse is fully open source under the AGPL-3.0 license. The source code is available on GitHub at <a href="https://github.com/nicepkg/cronpulse" class="text-blue-600 hover:underline" target="_blank" rel="noopener">github.com/nicepkg/cronpulse</a>. You can self-host it on Cloudflare Workers.</div>
        </details>
        <details class="bg-white border rounded-lg">
          <summary class="px-6 py-4 cursor-pointer font-medium text-gray-900 hover:text-blue-600">What notification channels does CronPulse support?</summary>
          <div class="px-6 pb-4 text-sm text-gray-600">CronPulse supports email alerts (all plans), Slack incoming webhooks, and custom webhook notifications. Recovery notifications are also sent when a check comes back online.</div>
        </details>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="py-8 text-center text-sm text-gray-400">
    <p>&copy; 2026 CronPulse. <a href="https://github.com/nicepkg/cronpulse" class="hover:text-gray-600">Open Source</a> &middot; Built on Cloudflare.</p>
  </footer>
  <script>
  (function(){
    var p=new URLSearchParams(location.search);
    var u={};
    ['utm_source','utm_medium','utm_campaign'].forEach(function(k){
      var v=p.get(k);if(v)u[k]=v;
    });
    var keys=Object.keys(u);
    if(!keys.length)return;
    var qs=keys.map(function(k){return k+'='+encodeURIComponent(u[k])}).join('&');
    document.querySelectorAll('a[href^="/auth/login"]').forEach(function(a){
      var href=a.getAttribute('href');
      a.setAttribute('href',href+(href.indexOf('?')>-1?'&':'?')+qs);
    });
    try{sessionStorage.setItem('cronpulse_utm',JSON.stringify(u));
      if(document.referrer)sessionStorage.setItem('cronpulse_referrer',document.referrer);
    }catch(e){}
  })();
  </script>
</body>
</html>`;
}
