import puppeteer from 'puppeteer'
import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const STREAM_URL_PATH = join(ROOT, 'stream-url.json')

const PAGE_URL = 'https://live.kankanews.com/huikan?id=10'

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function getStreamUrl() {
  console.log('[1] Launching browser...')
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 720 })

    const m3u8Urls = []
    page.on('request', request => {
      const url = request.url()
      if (url.includes('.m3u8') && !url.includes('manifest')) {
        m3u8Urls.push(url)
      }
    })

    console.log('[2] Navigating to', PAGE_URL)
    await page.goto(PAGE_URL, { waitUntil: 'networkidle2', timeout: 30000 })

    await sleep(3000)

    console.log('[3] Bypassing copyright shield...')
    const bypassResult = await page.evaluate(() => {
      const vue = document.querySelector('#__nuxt')?.__vue__
      if (!vue) return 'NO_VUE'

      function findComponent(root, name) {
        if (root.$options && root.$options.name === name) return root
        for (const child of root.$children || []) {
          const found = findComponent(child, name)
          if (found) return found
        }
        return null
      }

      const huikan = findComponent(vue, 'HuikanIndex')
      if (!huikan || !huikan.programObj) return 'NO_COMP'
      if (huikan.programObj.is_shield !== 1) return 'ALREADY'

      huikan.programObj.is_shield = 0
      huikan.$forceUpdate()
      setTimeout(() => { try { huikan.initPlayer() } catch (e) {} }, 100)
      return 'OK'
    })
    console.log('  Shield bypass:', bypassResult)

    console.log('[4] Waiting for m3u8 URL...')
    let m3u8Url = null
    for (let i = 0; i < 30; i++) {
      if (m3u8Urls.length > 0) {
        m3u8Url = m3u8Urls[m3u8Urls.length - 1]
        break
      }
      const perfUrl = await page.evaluate(() => {
        const entries = performance.getEntriesByType('resource')
        for (const entry of entries) {
          if (entry.name.includes('.m3u8') && !entry.name.includes('manifest')) {
            return entry.name
          }
        }
        return null
      })
      if (perfUrl) {
        m3u8Url = perfUrl
        break
      }
      await sleep(1000)
    }

    if (!m3u8Url) {
      throw new Error('Timed out waiting for m3u8 URL')
    }

    console.log('  Found:', m3u8Url)

    console.log('[5] Fetching m3u8 content from browser context...')
    const content = await page.evaluate(async (url) => {
      const resp = await fetch(url)
      if (!resp.ok) return null
      return await resp.text()
    }, m3u8Url)

    if (!content) {
      throw new Error('Failed to fetch m3u8 content from browser')
    }
    console.log('  Content OK, length:', content.length)

    const data = {
      m3u8Url,
      m3u8Content: content,
      title: 'SMG Five Sports',
      updatedAt: new Date().toISOString()
    }

    writeFileSync(STREAM_URL_PATH, JSON.stringify(data))
    console.log('[6] Written to stream-url.json (content length:', content.length, ')')
    return m3u8Url
  } finally {
    await browser.close()
  }
}

getStreamUrl().catch(err => {
  console.error('FAILED:', err.message)
  process.exit(1)
})
