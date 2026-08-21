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

      // 2026-08: fix all shield flags
      const fix = (o) => {
        if (!o) return
        o.is_shield = 0
        o.is_review = 1
        o.can_review = 1
      }
      fix(huikan.programObj)
      fix(huikan.programDetail)
      fix(huikan.playingProgramObj)
      if (Array.isArray(huikan.programList)) huikan.programList.forEach(fix)

      // 2026-08: clear copyright image
      if (huikan.currChannelDetail) { huikan.currChannelDetail.copyright_image = ''; huikan.currChannelDetail.live_shift = 0; }
      if (huikan.currChannel) { huikan.currChannel.copyright_image = ''; huikan.currChannel.live_shift = 0; }

      // 2026-08: restore live_address from channel detail (server removed it from program/detail API)
      if (huikan.currChannelDetail && huikan.currChannelDetail.live_address && huikan.programDetail) {
        huikan.programDetail.channel_info = huikan.programDetail.channel_info || {}
        if (!huikan.programDetail.channel_info.live_address) {
          huikan.programDetail.channel_info.live_address = huikan.currChannelDetail.live_address
        }
      }

      // 2026-08: bypass isCopyright gate (initPlayer destroys player when true)
      huikan.isCopyright = false

      const mask = document.querySelector('.image-mask')
      if (mask) mask.style.display = 'none'

      huikan.$forceUpdate()
      setTimeout(() => { try { huikan.initPlayer() } catch (e) {} }, 100)
      return 'OK'
    })
    console.log('  Shield bypass:', bypassResult)

    console.log('[4] Extracting program title...')
    let pageTitle = '五星体育'
    try {
      const extracted = await page.evaluate(() => {
        const vue = document.querySelector('#__nuxt')?.__vue__
        if (!vue) return null

        function findComponent(root, name) {
          if (root.$options && root.$options.name === name) return root
          for (const child of root.$children || []) {
            const found = findComponent(child, name)
            if (found) return found
          }
          return null
        }

        const huikan = findComponent(vue, 'HuikanIndex')
        if (!huikan) return null

        let channelName = '五星体育'
        if (huikan.currChannel && huikan.currChannel.name) channelName = huikan.currChannel.name
        else if (huikan.currChannelDetail && huikan.currChannelDetail.name) channelName = huikan.currChannelDetail.name

        let programName = ''
        if (huikan.programObj && huikan.programObj.name) programName = huikan.programObj.name
        else if (huikan.programDetail && huikan.programDetail.name) programName = huikan.programDetail.name
        else if (huikan.playingProgramObj && huikan.playingProgramObj.name) programName = huikan.playingProgramObj.name

        if (programName) return channelName + ' - ' + programName
        return channelName
      })
      if (extracted) pageTitle = extracted
    } catch (e) {
      console.log('  Title extraction failed, using default')
    }
    console.log('  Title:', pageTitle)

    console.log('[5] Waiting for m3u8 URL...')
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

    console.log('[6] Fetching m3u8 content from browser context...')
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
      title: pageTitle,
      updatedAt: new Date().toISOString()
    }

    writeFileSync(STREAM_URL_PATH, JSON.stringify(data))
    console.log('[7] Written to stream-url.json (content length:', content.length, ')')
    return m3u8Url
  } finally {
    await browser.close()
  }
}

getStreamUrl().catch(err => {
  console.error('FAILED:', err.message)
  process.exit(1)
})
