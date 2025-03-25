// Use puppeteer-extra with stealth plugin
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const path = require('path');

// Apply the stealth plugin
puppeteer.use(StealthPlugin());

// Job titles to search for - keeping your original list
const TARGET_JOB_TITLES = [
  'pre-sales solution consultant',
  'product manager',
  'program manager', 
  'senior project manager',
  'associate product manager',
  'digital consultant',
  'product consultant',
  'ai strategy',
  'digital product manager'
];

// Career URLs to check - keeping your original list
const CAREER_URLS = [
  'https://careers.adyen.com/vacancies?location=Amsterdam',
  'https://www.crobox.com/careers-crobox',
  'https://www.workingatwearebrain.com/',
  'https://www.valtech.com/nl-nl/carriere/vacatures/?country=netherlands',
  'https://commercetools.com/careers/jobs',
  'https://www.contentstack.com/company/careers',
  'https://www.epam.com/careers/job-listings?country=Netherlands&city=Amsterdam',
  'https://www.bloomreach.com/en/careers'
];

// Main function to run the job search
async function runJobSearch() {
  console.log('Starting job search automation...');
  
  // Launch browser with stealth mode
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });
  
  // Results array
  const results = [];
  const newJobs = [];
  
  try {
    // Load previous results if they exist
    let previousResults = [];
    try {
      const previousData = await fs.readFile('job-results.json', 'utf8');
      previousResults = JSON.parse(previousData);
    } catch (error) {
      console.log('No previous results found, creating new file');
    }
    
    // Process each career URL
    for (const careerUrl of CAREER_URLS) {
      console.log(`\nProcessing: ${careerUrl}`);
      
      const page = await browser.newPage();
      
      // Set a more realistic user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');
      
      // Set viewport to a common resolution
      await page.setViewport({ width: 1920, height: 1080 });
      
      // Add additional headers to appear more like a real browser
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0'
      });
      
      try {
        // Log the URL we're trying to access
        console.log(`Visiting: ${careerUrl}`);
        
        // Visit the career page with a longer timeout
        await page.goto(careerUrl, { 
          waitUntil: 'networkidle2', 
          timeout: 60000 
        });
        
        // Take a screenshot for debugging (especially useful for EPAM)
        if (careerUrl.includes('epam.com')) {
          await page.screenshot({ path: 'epam-debug.png' });
          console.log('Saved screenshot to epam-debug.png');
          
          // Check if we got blocked
          const pageContent = await page.content();
          if (pageContent.includes('Access denied') || pageContent.includes('Error 1005')) {
            console.error(`Blocked by ${careerUrl} - Access denied`);
            results.push({
              careerUrl,
              lastChecked: new Date().toISOString(),
              error: 'Access denied by website',
              jobs: []
            });
            continue;
          }
        }
        
        // Extract job listings
        const jobListings = await extractJobListings(page);
        console.log(`Found ${jobListings.length} total job listings`);
        
        // Filter for matching job titles
        const matchingJobs = filterJobsByTitle(jobListings, TARGET_JOB_TITLES);
        console.log(`Found ${matchingJobs.length} matching job listings`);
        
        // Check for new jobs
        const previousJobsForSite = previousResults.find(r => r.careerUrl === careerUrl);
        const previousJobLinks = previousJobsForSite ? previousJobsForSite.jobs.map(j => j.link) : [];
        
        const newJobsForSite = matchingJobs.filter(job => !previousJobLinks.includes(job.link));
        
        if (newJobsForSite.length > 0) {
          console.log(`Found ${newJobsForSite.length} NEW matching jobs!`);
          newJobs.push(...newJobsForSite.map(job => ({
            ...job,
            company: new URL(careerUrl).hostname.replace('www.', '').split('.')[0],
            careerUrl
          })));
        }
        
        // Add to results
        results.push({
          careerUrl,
          lastChecked: new Date().toISOString(),
          jobs: matchingJobs
        });
      } catch (error) {
        console.error(`Error processing ${careerUrl}:`, error.message);
        results.push({
          careerUrl,
          lastChecked: new Date().toISOString(),
          error: error.message,
          jobs: []
        });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  
  // Save results to JSON file
  await fs.writeFile('job-results.json', JSON.stringify(results, null, 2));
  console.log('\nResults saved to job-results.json');
  
  // Generate HTML report
  await generateHtmlReport(results, newJobs);
  console.log('HTML report generated: job-report.html');
  
  // Print summary of new jobs
  if (newJobs.length > 0) {
    console.log('\n🎉 NEW JOBS FOUND! 🎉');
    console.log('---------------------');
    
    newJobs.forEach((job, index) => {
      console.log(`${index + 1}. ${job.title}`);
      console.log(`   Company: ${job.company}`);
      if (job.location) console.log(`   Location: ${job.location}`);
      console.log(`   Link: ${job.link}`);
      console.log('');
    });
  } else {
    console.log('\nNo new jobs found matching your criteria.');
  }
}

// Extract job listings from a page - using your original implementation
async function extractJobListings(page) {
  // Wait for job listings to load
  await page.waitForSelector('a, div, li, tr', { timeout: 10000 });
  
  // Extract job listings
  return page.evaluate(() => {
    // Common patterns for job listings
    const jobElements = Array.from(document.querySelectorAll(
      '.job-listing, .job-card, .job-result, .job-item, ' +
      'div[class*="job"], li[class*="job"], tr[class*="job"], ' +
      'table tr, ' +
      'ul > li, ol > li, ' +
      'div.row, .card, .listing'
    ));
    
    return jobElements.map(element => {
      // Try to find job title
      const titleElement = element.querySelector(
        'h1, h2, h3, h4, h5, ' +
        'a[class*="title"], span[class*="title"], div[class*="title"], ' +
        'a[class*="job"], span[class*="job"], div[class*="job"], ' +
        'a[class*="position"], span[class*="position"], div[class*="position"], ' +
        'a[class*="role"], span[class*="role"], div[class*="role"], ' +
        'a, .name, .position, .role'
      );
      
      const title = titleElement ? titleElement.textContent.trim() : '';
      
      // Try to find location
      const locationElement = element.querySelector(
        '[class*="location"], [class*="place"], [class*="city"], ' +
        '[class*="address"], [class*="region"], [class*="country"], ' +
        '.location, .place, .city, .address'
      );
      
      const location = locationElement ? locationElement.textContent.trim() : '';
      
      // Try to find link to job details
      let link = '';
      const linkElement = element.querySelector('a');
      if (linkElement && linkElement.href) {
        link = linkElement.href;
      } else if (element.tagName === 'A' && element.href) {
        link = element.href;
      }
      
      return { title, location, link };
    }).filter(job => job.title && job.link); // Only keep jobs with title and link
  });
}

// Filter job listings by target job titles - using your original implementation
function filterJobsByTitle(jobListings, targetTitles) {
  // Create regex patterns for each target job title
  const titlePatterns = targetTitles.map(title => 
    new RegExp(`\\b${title.replace(/\s+/g, '\\s+')}\\b`, 'i')
  );
  
  // Filter job listings
  return jobListings.filter(job => {
    // Check if job title matches any of the target titles
    return titlePatterns.some(pattern => pattern.test(job.title));
  });
}

// Generate HTML report - using your original implementation
async function generateHtmlReport(results, newJobs) {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Job Search Results</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    h1, h2, h3 {
      color: #333;
    }
    .company {
      margin-bottom: 30px;
      border-bottom: 1px solid #eee;
      padding-bottom: 20px;
    }
    .job {
      margin-bottom: 15px;
      padding: 15px;
      border-radius: 5px;
    }
    .new-job {
      background-color: #e6f7e6;
      border-left: 4px solid #28a745;
    }
    .regular-job {
      background-color: #f8f9fa;
    }
    .job-title {
      font-weight: bold;
      font-size: 18px;
      margin-bottom: 5px;
    }
    .job-location {
      color: #666;
      margin-bottom: 10px;
    }
    .job-link {
      display: inline-block;
      background-color: #007bff;
      color: white;
      padding: 5px 10px;
      text-decoration: none;
      border-radius: 3px;
    }
    .job-link:hover {
      background-color: #0056b3;
    }
    .summary {
      background-color: #f8f9fa;
      padding: 15px;
      border-radius: 5px;
      margin-bottom: 20px;
    }
    .new-jobs-section {
      margin-bottom: 30px;
    }
    .timestamp {
      color: #666;
      font-style: italic;
      margin-top: 5px;
    }
  </style>
</head>
<body>
  <h1>Job Search Results</h1>
  <div class="timestamp">Last updated: ${new Date().toLocaleString()}</div>
  
  <div class="summary">
    <h2>Summary</h2>
    <p>Checked ${results.length} career sites and found ${results.reduce((total, site) => total + site.jobs.length, 0)} matching jobs.</p>
    <p>${newJobs.length > 0 ? `🎉 Found ${newJobs.length} new matching jobs!` : 'No new jobs found in this run.'}</p>
  </div>
  
  ${newJobs.length > 0 ? `
  <div class="new-jobs-section">
    <h2>New Jobs</h2>
    ${newJobs.map(job => `
      <div class="job new-job">
        <div class="job-title">${job.title}</div>
        <div class="job-location">Company: ${job.company} ${job.location ? `| Location: ${job.location}` : ''}</div>
        <a href="${job.link}" target="_blank" class="job-link">View Job</a>
      </div>
    `).join('')}
  </div>
  ` : ''}
  
  <h2>All Matching Jobs</h2>
  ${results.map(site => `
    <div class="company">
      <h3>${new URL(site.careerUrl).hostname.replace('www.', '')}</h3>
      <p>Career URL: <a href="${site.careerUrl}" target="_blank">${site.careerUrl}</a></p>
      <p>Last checked: ${new Date(site.lastChecked).toLocaleString()}</p>
      
      ${site.error ? `<p style="color: red;">Error: ${site.error}</p>` : ''}
      
      ${site.jobs.length === 0 ? 
        '<p>No matching jobs found</p>' : 
        site.jobs.map(job => {
          const isNew = newJobs.some(newJob => newJob.link === job.link);
          return `
            <div class="job ${isNew ? 'new-job' : 'regular-job'}">
              <div class="job-title">${job.title} ${isNew ? '(NEW)' : ''}</div>
              ${job.location ? `<div class="job-location">Location: ${job.location}</div>` : ''}
              <a href="${job.link}" target="_blank" class="job-link">View Job</a>
            </div>
          `;
        }).join('')
      }
    </div>
  `).join('')}
</body>
</html>
  `;
  
  await fs.writeFile('job-report.html', html);
}

// Run the job search
runJobSearch().catch(error => {
  console.error('Job search automation failed:', error);
  process.exit(1);
});
