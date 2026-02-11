export function renderLandingPage(appUrl: string = 'https://cronpulse.dev'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CronPulse — Cron Job Monitoring Made Simple</title>
  <meta name="description" content="Monitor your cron jobs with a single curl. Get alerted when they fail. Free for up to 10 checks.">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-white">
  <!-- Nav -->
  <nav class="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
    <span class="text-xl font-bold">CronPulse</span>
    <div class="flex items-center gap-4">
      <a href="#pricing" class="text-sm text-gray-600 hover:text-gray-900">Pricing</a>
      <a href="/docs" class="text-sm text-gray-600 hover:text-gray-900">Docs</a>
      <a href="/blog" class="text-sm text-gray-600 hover:text-gray-900">Blog</a>
      <a href="/auth/login" class="text-sm text-gray-600 hover:text-gray-900">Login</a>
      <a href="/auth/login" class="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">
        Get Started Free
      </a>
    </div>
  </nav>

  <!-- Early Preview Banner -->
  <div class="bg-amber-50 border-b border-amber-200">
    <div class="max-w-5xl mx-auto px-4 py-2 text-center">
      <p class="text-amber-800 text-sm">Early Preview — Fully functional, free to try. Email alerts coming soon.</p>
    </div>
  </div>

  <!-- Hero -->
  <section class="max-w-3xl mx-auto px-4 pt-20 pb-16 text-center">
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
      <h2 class="text-2xl font-bold text-center mb-12">Simple, reliable monitoring</h2>
      <div class="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
        <div class="flex gap-3">
          <div class="text-green-500 mt-1">&#10003;</div>
          <div>
            <h3 class="font-semibold">Instant alerts</h3>
            <p class="text-sm text-gray-600">Email, Slack, and webhook notifications when checks go down or recover.</p>
          </div>
        </div>
        <div class="flex gap-3">
          <div class="text-green-500 mt-1">&#10003;</div>
          <div>
            <h3 class="font-semibold">Configurable grace periods</h3>
            <p class="text-sm text-gray-600">Set how long to wait before alerting. No false alarms.</p>
          </div>
        </div>
        <div class="flex gap-3">
          <div class="text-green-500 mt-1">&#10003;</div>
          <div>
            <h3 class="font-semibold">Global edge network</h3>
            <p class="text-sm text-gray-600">Runs on Cloudflare's 300+ locations. Sub-5ms ping response time.</p>
          </div>
        </div>
        <div class="flex gap-3">
          <div class="text-green-500 mt-1">&#10003;</div>
          <div>
            <h3 class="font-semibold">Recovery notifications</h3>
            <p class="text-sm text-gray-600">Know when a check recovers, not just when it goes down.</p>
          </div>
        </div>
        <div class="flex gap-3">
          <div class="text-green-500 mt-1">&#10003;</div>
          <div>
            <h3 class="font-semibold">Ping history</h3>
            <p class="text-sm text-gray-600">See when each check was last pinged and its complete history.</p>
          </div>
        </div>
        <div class="flex gap-3">
          <div class="text-green-500 mt-1">&#10003;</div>
          <div>
            <h3 class="font-semibold">REST API</h3>
            <p class="text-sm text-gray-600">Manage checks programmatically. Perfect for CI/CD integration.</p>
          </div>
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

  <!-- Footer -->
  <footer class="py-8 text-center text-sm text-gray-400">
    <p>&copy; 2026 CronPulse. Built on Cloudflare.</p>
  </footer>
</body>
</html>`;
}
