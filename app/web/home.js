// Home page controller: catalog feed, search/voice/image entry points, and quick suggest/cart actions.

import {
  initialLanguage,
  languageOptions,
  normalizeLanguage,
  persistLanguage,
  t,
  withLangHref,
  withLangPath,
} from '/static/i18n.js';

const grid = document.getElementById('home-grid');
const statusText = document.getElementById('status-text');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const voiceButton = document.getElementById('voice-button');
const refreshButton = document.getElementById('refresh-button');
const homeNavLink = document.getElementById('nav-home');
const genderNavLinks = Array.from(document.querySelectorAll('.top-nav a[data-gender]'));
const cartButton = document.getElementById('cart-button');
const profileButton = document.getElementById('profile-button');
const languageSelect = document.getElementById('language-select');
const footerLinks = Array.from(document.querySelectorAll('.site-footer a[data-content-slug]'));

const uploadModal = document.getElementById('upload-modal');
const cameraButton = document.getElementById('camera-button');
const closeModalButton = document.getElementById('close-modal');
const uploadForm = document.getElementById('upload-form');
const imageInput = document.getElementById('image-input');

const profileModal = document.getElementById('profile-modal');
const profileContent = document.getElementById('profile-content');
const closeProfileModalButton = document.getElementById('close-profile-modal');
const cartModal = document.getElementById('cart-modal');
const cartContent = document.getElementById('cart-content');
const closeCartModalButton = document.getElementById('close-cart-modal');
const infoModal = document.getElementById('info-modal');
const infoModalTitle = document.getElementById('info-modal-title');
const infoModalContent = document.getElementById('info-modal-content');
const closeInfoModalButton = document.getElementById('close-info-modal');

const SHOPPER_NAME = 'GlobalMart Fashion Shopper';
const params = new URLSearchParams(window.location.search);
let currentGenderFilter = normalizeGender(params.get('gender'));
let currentLanguage = initialLanguage(params);
const HOME_FEED_TIMEOUT_MS = 20000;
const API_TIMEOUT_MS = 45000;
const IMAGE_MATCH_TIMEOUT_MS = 45000;
const IMAGE_RESIZE_MAX_DIMENSION = 1280;
const IMAGE_RESIZE_MIN_BYTES = 850000;

let mediaRecorder = null;
let recorderStream = null;
let recordingChunks = [];
let recordingStopTimer = null;
let speechRecognition = null;
let speechRecognitionActive = false;
let speechFallbackAttempted = false;

function normalizeGender(rawValue) {
  if (!rawValue) {
    return null;
  }
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'women' || normalized === 'woman') {
    return 'Women';
  }
  if (normalized === 'men' || normalized === 'man') {
    return 'Men';
  }
  return null;
}

function updateUrlForLanguage() {
  const url = new URL(window.location.href);
  url.searchParams.set('lang', currentLanguage);
  if (currentGenderFilter) {
    url.searchParams.set('gender', currentGenderFilter);
  } else {
    url.searchParams.delete('gender');
  }
  window.history.replaceState({}, '', `${url.pathname}${url.search}`);
}

function localizeFooter() {
  const headingMap = ['company', 'assistance', 'legal', 'follow_us'];
  document.querySelectorAll('.site-footer h4').forEach((heading, idx) => {
    const key = headingMap[idx];
    if (key) {
      heading.textContent = t(currentLanguage, key);
    }
  });
  const linkMap = {
    about: 'about',
    careers: 'careers',
    stores: 'stores',
    'customer-service': 'customer_service',
    delivery: 'delivery',
    returns: 'returns',
    terms: 'terms',
    privacy: 'privacy',
    cookies: 'cookies',
    instagram: 'instagram',
    youtube: 'youtube',
    linkedin: 'linkedin',
  };
  footerLinks.forEach((link) => {
    const key = linkMap[link.dataset.contentSlug || ''];
    if (key) {
      link.textContent = t(currentLanguage, key);
    }
  });
}

function applyStaticLanguage() {
  document.documentElement.lang = currentLanguage;
  const setText = (id, key) => {
    const node = document.getElementById(id);
    if (node) {
      node.textContent = t(currentLanguage, key);
    }
  };

  setText('brand-eyebrow', 'brand_eyebrow');
  setText('brand-title', 'brand_title');
  setText('nav-home', 'nav_home');
  setText('nav-women', 'nav_women');
  setText('nav-men', 'nav_men');
  setText('nav-personalized', 'nav_personalized');
  setText('search-submit', 'find_items');
  setText('hero-title-home', 'hero_title_home');
  setText('hero-description', 'hero_desc_home');
  setText('section-title-home', 'suggested_for_you');
  setText('refresh-button', 'refresh_feed');
  setText('upload-modal-title', 'upload_title');
  setText('upload-modal-desc', 'upload_desc');
  setText('upload-label', 'choose_image');
  setText('upload-submit', 'upload_and_match');
  setText('profile-modal-title', 'profile');
  setText('cart-modal-title', 'your_cart');

  searchInput.placeholder = t(currentLanguage, 'search_placeholder_home');
  voiceButton.title = t(currentLanguage, 'voice_title');
  voiceButton.setAttribute('aria-label', t(currentLanguage, 'voice_title'));
  cameraButton.title = t(currentLanguage, 'image_upload_match');
  cameraButton.setAttribute('aria-label', t(currentLanguage, 'image_upload_match'));
  cartButton.title = t(currentLanguage, 'cart');
  cartButton.setAttribute('aria-label', t(currentLanguage, 'cart'));
  profileButton.title = t(currentLanguage, 'profile');
  profileButton.setAttribute('aria-label', t(currentLanguage, 'profile'));
  closeModalButton.textContent = t(currentLanguage, 'cancel');
  closeProfileModalButton.textContent = t(currentLanguage, 'close');
  closeCartModalButton.textContent = t(currentLanguage, 'close');
  closeInfoModalButton.textContent = t(currentLanguage, 'close');
  if (infoModalTitle && infoModalTitle.textContent === 'Info') {
    infoModalTitle.textContent = t(currentLanguage, 'info');
  }

  const navHome = document.getElementById('nav-home');
  const navWomen = document.getElementById('nav-women');
  const navMen = document.getElementById('nav-men');
  const navPersonalized = document.getElementById('nav-personalized');
  if (navHome) {
    navHome.setAttribute('href', withLangHref('/', currentLanguage));
  }
  if (navWomen) {
    navWomen.setAttribute('href', withLangHref('/?gender=Women', currentLanguage));
  }
  if (navMen) {
    navMen.setAttribute('href', withLangHref('/?gender=Men', currentLanguage));
  }
  if (navPersonalized) {
    navPersonalized.setAttribute('href', withLangHref('/personalized', currentLanguage));
  }

  localizeFooter();
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle('error', isError);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    let payload = null;
    try {
      payload = await response.json();
    } catch (_error) {
      payload = null;
    }
    return { response, payload };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s. Please try again.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function setVoiceButtonState(isRecording) {
  if (!voiceButton) {
    return;
  }
  voiceButton.classList.toggle('is-recording', isRecording);
  const resting = t(currentLanguage, 'voice_title');
  const active = `${resting} (Stop)`;
  voiceButton.setAttribute('aria-label', isRecording ? active : resting);
  voiceButton.title = isRecording ? active : resting;
}

function speechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function speechLocale() {
  const selected = languageOptions().find((option) => option.code === currentLanguage);
  return selected?.locale || navigator.language || 'en-US';
}

function canUseRecorderFallback() {
  return Boolean(navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined');
}

function clearRecorderTimer() {
  if (recordingStopTimer) {
    clearTimeout(recordingStopTimer);
    recordingStopTimer = null;
  }
}

function releaseRecorderStream() {
  if (recorderStream) {
    recorderStream.getTracks().forEach((track) => track.stop());
    recorderStream = null;
  }
}

function stopBrowserSpeechRecognition() {
  if (speechRecognition && speechRecognitionActive) {
    speechRecognition.stop();
  }
}

function maybeSwitchToRecorderFallback(reason) {
  if (!canUseRecorderFallback() || speechFallbackAttempted) {
    setStatus(reason, true);
    return;
  }
  speechFallbackAttempted = true;
  setStatus(`${reason} Switching to secure audio fallback...`);
  window.setTimeout(() => {
    startVoiceCapture();
  }, 0);
}

function startBrowserSpeechRecognition() {
  const Recognition = speechRecognitionCtor();
  if (!Recognition) {
    return false;
  }

  speechRecognition = new Recognition();
  speechRecognition.lang = speechLocale();
  speechRecognition.interimResults = true;
  speechRecognition.continuous = false;

  let finalTranscript = '';
  speechRecognitionActive = true;
  setVoiceButtonState(true);
  setStatus('Listening...');

  speechRecognition.onresult = (event) => {
    let combined = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      combined += event.results[i][0]?.transcript || '';
      if (event.results[i].isFinal) {
        finalTranscript += `${event.results[i][0]?.transcript || ''} `;
      }
    }
    const preview = (finalTranscript || combined).trim();
    if (preview) {
      searchInput.value = preview;
    }
  };

  speechRecognition.onerror = (event) => {
    speechRecognitionActive = false;
    setVoiceButtonState(false);
    const errorCode = event?.error || 'unknown_error';

    if (errorCode === 'not-allowed' || errorCode === 'service-not-allowed') {
      setStatus('Microphone permission was denied. Enable mic permission and try again.', true);
      return;
    }
    if (errorCode === 'aborted') {
      return;
    }
    if (errorCode === 'no-speech') {
      maybeSwitchToRecorderFallback('No speech detected from browser recognition.');
      return;
    }

    maybeSwitchToRecorderFallback(`Browser speech recognition failed (${errorCode}).`);
  };

  speechRecognition.onend = () => {
    speechRecognitionActive = false;
    setVoiceButtonState(false);
    const text = (finalTranscript || searchInput.value || '').trim();
    if (!text) {
      maybeSwitchToRecorderFallback('No final transcript captured.');
      return;
    }
    searchInput.value = text;
    searchInput.focus();
    setStatus('Voice transcription complete.');
  };

  speechRecognition.start();
  return true;
}

function preferredAudioMimeType() {
  if (typeof MediaRecorder === 'undefined') {
    return '';
  }

  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || '';
}

function extensionFromMimeType(mimeType) {
  const normalized = (mimeType || '').toLowerCase();
  if (normalized.includes('webm')) {
    return 'webm';
  }
  if (normalized.includes('ogg')) {
    return 'ogg';
  }
  if (normalized.includes('wav')) {
    return 'wav';
  }
  if (normalized.includes('mp4') || normalized.includes('mpeg') || normalized.includes('aac')) {
    return 'm4a';
  }
  return 'webm';
}

async function transcribeAudioBlob(audioBlob) {
  if (!audioBlob || audioBlob.size === 0) {
    throw new Error('No audio captured. Please try again.');
  }

  const extension = extensionFromMimeType(audioBlob.type);
  const audioFile = new File([audioBlob], `voice-input.${extension}`, {
    type: audioBlob.type || 'audio/webm',
  });

  const formData = new FormData();
  formData.append('audio', audioFile);

  const { response, payload } = await fetchJsonWithTimeout(
    '/api/transcribe',
    {
      method: 'POST',
      body: formData,
    },
    60000
  );
  if (!response.ok) {
    throw new Error(payload?.detail || 'Voice transcription failed.');
  }

  const text = (payload?.text || '').trim();
  if (!text) {
    throw new Error('No speech was detected. Please try again.');
  }

  return text;
}

async function startVoiceCapture() {
  if (!canUseRecorderFallback()) {
    setStatus('Voice capture is not supported in this browser. Use typed search.', true);
    return;
  }

  try {
    recorderStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingChunks = [];
    const mimeType = preferredAudioMimeType();
    mediaRecorder = mimeType ? new MediaRecorder(recorderStream, { mimeType }) : new MediaRecorder(recorderStream);

    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) {
        recordingChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener('stop', async () => {
      clearRecorderTimer();
      releaseRecorderStream();
      setVoiceButtonState(false);

      const blobType = mediaRecorder?.mimeType || mimeType || 'audio/webm';
      const audioBlob = new Blob(recordingChunks, { type: blobType });
      mediaRecorder = null;

      setStatus('Transcribing voice...');
      try {
        const text = await transcribeAudioBlob(audioBlob);
        searchInput.value = text;
        searchInput.focus();
        setStatus('Voice transcription complete.');
      } catch (error) {
        setStatus(`${error.message} You can continue with typed search or image upload.`, true);
      }
    });

    mediaRecorder.start();
    setVoiceButtonState(true);
    setStatus('Listening with audio fallback...');

    recordingStopTimer = setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    }, 10000);
  } catch (error) {
    releaseRecorderStream();
    setVoiceButtonState(false);
    setStatus(error.message || 'Unable to access microphone.', true);
  }
}

function stopVoiceCapture() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
}

function toggleVoiceCapture() {
  const Recognition = speechRecognitionCtor();
  if (Recognition) {
    if (speechRecognitionActive) {
      stopBrowserSpeechRecognition();
      return;
    }
    speechFallbackAttempted = false;
    startBrowserSpeechRecognition();
    return;
  }

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopVoiceCapture();
    return;
  }
  startVoiceCapture();
}

function attachImageFallback(imageEl) {
  if (!imageEl) {
    return;
  }
  imageEl.addEventListener('error', () => {
    if (!imageEl.dataset.fallbackApplied) {
      imageEl.dataset.fallbackApplied = '1';
      imageEl.src = '/static/placeholder-image.svg';
    }
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode image.'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

async function optimizeImageForUpload(file) {
  if (!(file instanceof File) || !file.type.startsWith('image/')) {
    return file;
  }
  if (file.size < IMAGE_RESIZE_MIN_BYTES) {
    return file;
  }

  try {
    const image = await loadImageFromFile(file);
    const longestEdge = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height);
    const scale = Math.min(1, IMAGE_RESIZE_MAX_DIMENSION / Math.max(1, longestEdge));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return file;
    }
    ctx.drawImage(image, 0, 0, width, height);

    const optimizedBlob = await canvasToBlob(canvas, 'image/jpeg', 0.82);
    if (!optimizedBlob || optimizedBlob.size <= 0) {
      return file;
    }
    if (optimizedBlob.size >= file.size * 0.95) {
      return file;
    }

    const baseName = file.name.replace(/\.[^/.]+$/, '') || 'upload';
    return new File([optimizedBlob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch (_error) {
    return file;
  }
}

async function sendFeedback(eventType, productId, sessionId = null, eventValue = null) {
  try {
    await fetchJsonWithTimeout(withLangPath('/api/feedback', currentLanguage), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        shopper_name: SHOPPER_NAME,
        event_type: eventType,
        product_id: productId,
        session_id: sessionId,
        event_value: eventValue,
      }),
    });
  } catch (_error) {
    // Feedback must not block UX.
  }
}

async function openProfileModal() {
  try {
    const { response, payload } = await fetchJsonWithTimeout(
      withLangPath(`/api/profile?shopper_name=${encodeURIComponent(SHOPPER_NAME)}`, currentLanguage)
    );
    if (!response.ok) {
      throw new Error(payload?.detail || 'Could not load profile.');
    }
    profileContent.innerHTML = `
      <p><strong>${escapeHtml(t(currentLanguage, 'profile'))}:</strong> ${escapeHtml(payload.shopper_name)}</p>
      <p><strong>Tier:</strong> ${escapeHtml(payload.membership_tier)}</p>
      <p><strong>Preferred:</strong> ${escapeHtml(payload.preferred_gender)}</p>
      <p><strong>Color:</strong> ${escapeHtml(payload.favorite_color)}</p>
      <p><strong>Article:</strong> ${escapeHtml(payload.favorite_article_type)}</p>
      <p><strong>${escapeHtml(t(currentLanguage, 'cart'))}:</strong> ${Number(payload.cart_items || 0)}</p>
      <p class="product-desc">Clicks ${Number(payload.click_events || 0)}, cart adds ${Number(payload.cart_add_events || 0)}.</p>
    `;
    profileModal?.showModal();
  } catch (error) {
    setStatus(error.message, true);
  }
}

function closeProfileModal() {
  profileModal?.close();
}

function renderCart(items) {
  if (!items?.length) {
    cartContent.innerHTML = `<p class="product-desc">${escapeHtml(t(currentLanguage, 'empty_cart'))}</p>`;
    return;
  }
  cartContent.innerHTML = `
    <div class="cart-list">
      ${items
        .map(
          (item) => `
            <div class="cart-row">
              <img src="${item.image_url}" alt="${escapeHtml(item.name)}" loading="lazy" />
              <div>
                <strong>${escapeHtml(item.name)}</strong>
                <p class="product-desc">${escapeHtml(t(currentLanguage, 'quantity'))}: ${Number(item.quantity || 1)}</p>
              </div>
              <button class="secondary-button cart-remove" data-product-id="${Number(item.id)}" type="button">${escapeHtml(t(currentLanguage, 'remove'))}</button>
            </div>
          `
        )
        .join('')}
    </div>
  `;
  cartContent.querySelectorAll('img').forEach((img) => attachImageFallback(img));
  cartContent.querySelectorAll('.cart-remove').forEach((button) => {
    button.addEventListener('click', async () => {
      const productId = Number(button.dataset.productId);
      try {
        await fetchJsonWithTimeout(withLangPath('/api/cart/remove', currentLanguage), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            shopper_name: SHOPPER_NAME,
            product_id: productId,
            lang: currentLanguage,
          }),
        });
        await openCartModal();
      } catch (error) {
        setStatus(error.message, true);
      }
    });
  });
}

async function openCartModal() {
  try {
    const { response, payload } = await fetchJsonWithTimeout(
      withLangPath(`/api/cart?shopper_name=${encodeURIComponent(SHOPPER_NAME)}`, currentLanguage)
    );
    if (!response.ok) {
      throw new Error(payload?.detail || 'Could not load cart.');
    }
    renderCart(payload?.items || []);
    cartModal?.showModal();
  } catch (error) {
    setStatus(error.message, true);
  }
}

function closeCartModal() {
  cartModal?.close();
}

async function openInfoModal(slug) {
  try {
    const { response, payload } = await fetchJsonWithTimeout(
      withLangPath(`/api/content/${encodeURIComponent(slug)}`, currentLanguage)
    );
    if (!response.ok) {
      throw new Error(payload?.detail || 'No information available.');
    }
    if (infoModalTitle) {
      infoModalTitle.textContent = payload?.title || 'Info';
    }
    if (infoModalContent) {
      infoModalContent.innerHTML = `<p class="product-desc">${escapeHtml(payload?.body || '')}</p>`;
    }
    infoModal?.showModal();
  } catch (error) {
    setStatus(error.message, true);
  }
}

function closeInfoModal() {
  infoModal?.close();
}

function updateNavSelection() {
  genderNavLinks.forEach((link) => {
    const linkGender = normalizeGender(link.dataset.gender || '');
    link.classList.toggle('active', Boolean(linkGender && linkGender === currentGenderFilter));
  });
  homeNavLink?.classList.toggle('active', !currentGenderFilter);
}

function updateUrlGenderFilter() {
  const url = new URL(window.location.href);
  url.searchParams.set('lang', currentLanguage);
  if (currentGenderFilter) {
    url.searchParams.set('gender', currentGenderFilter);
  } else {
    url.searchParams.delete('gender');
  }
  window.history.replaceState({}, '', `${url.pathname}${url.search}`);
}

async function addToCart(productId) {
  const { response, payload } = await fetchJsonWithTimeout(withLangPath('/api/cart/add', currentLanguage), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      shopper_name: SHOPPER_NAME,
      product_id: productId,
      quantity: 1,
      lang: currentLanguage,
    }),
  });
  if (!response.ok) {
    throw new Error(payload?.detail || 'Could not add item to cart.');
  }
  setStatus(t(currentLanguage, 'status_added_cart'));
}

async function seedSessionForCompleteLook(product) {
  const { response, payload } = await fetchJsonWithTimeout(withLangPath('/api/suggest-session', currentLanguage), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      shopper_name: SHOPPER_NAME,
      product_id: Number(product.id),
      lang: currentLanguage,
    }),
  });

  if (!response.ok) {
    throw new Error(payload?.detail || 'Could not create suggest session.');
  }
  const sessionId = payload?.session_id;
  if (!sessionId) {
    throw new Error('Session creation succeeded but no session id was returned.');
  }
  return sessionId;
}

function productCard(product) {
  const article = document.createElement('article');
  article.className = 'product-card interactive-card';

  article.innerHTML = `
    <img src="${product.image_url}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async" />
    <div class="product-copy">
      <h4>${escapeHtml(product.name)}</h4>
      <div class="product-meta">
        <span>${escapeHtml(product.gender)}</span>
        <span>${escapeHtml(product.article_type)}</span>
        <span>${escapeHtml(product.base_colour)}</span>
        <span>${escapeHtml(product.usage || 'Lifestyle')}</span>
      </div>
      <p class="product-desc">${escapeHtml(product.master_category)} / ${escapeHtml(
        product.sub_category
      )} | Season: ${escapeHtml(product.season || 'All')} | Year: ${escapeHtml(product.year || 'n/a')}</p>
      <div class="card-feature-actions">
        <button class="feature-action complete-look-button" type="button" title="${escapeHtml(t(currentLanguage, 'suggest'))}">${escapeHtml(t(currentLanguage, 'suggest'))}</button>
        <button class="feature-action add-cart-button" type="button" title="${escapeHtml(t(currentLanguage, 'buy'))}" data-product-id="${Number(product.id)}">${escapeHtml(t(currentLanguage, 'buy'))}</button>
      </div>
    </div>
  `;

  const image = article.querySelector('img');
  attachImageFallback(image);

  article.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('button')) {
      return;
    }
    sendFeedback('click', Number(product.id), null, 'home_card_click');
  });

  const lookButton = article.querySelector('.complete-look-button');
  const addButton = article.querySelector('.add-cart-button');

  lookButton?.addEventListener('click', async (event) => {
    event.stopPropagation();
    lookButton.disabled = true;
    setStatus(t(currentLanguage, 'status_prepare_suggest'));
    try {
      const sessionId = await seedSessionForCompleteLook(product);
      sendFeedback('complete_look', Number(product.id), sessionId, 'home_seed');
      window.location.href = `/personalized?session=${encodeURIComponent(sessionId)}&complete_anchor=${encodeURIComponent(
        product.id
      )}&focus=suggest&lang=${encodeURIComponent(currentLanguage)}`;
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      lookButton.disabled = false;
    }
  });

  addButton?.addEventListener('click', async (event) => {
    event.stopPropagation();
    addButton.disabled = true;
    try {
      await addToCart(Number(product.id));
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      addButton.disabled = false;
    }
  });

  return article;
}

async function loadHomeProducts() {
  const filterLabel = currentGenderFilter ? `${currentGenderFilter} catalog selections` : 'catalog selections';
  setStatus(t(currentLanguage, 'status_loading_catalog', { label: filterLabel }));
  grid.innerHTML = '';

  try {
    const requestUrl = new URL('/api/home-products', window.location.origin);
    requestUrl.searchParams.set('limit', '24');
    requestUrl.searchParams.set('lang', currentLanguage);
    if (currentGenderFilter) {
      requestUrl.searchParams.set('gender', currentGenderFilter);
    }

    const { response, payload } = await fetchJsonWithTimeout(
      `${requestUrl.pathname}${requestUrl.search}`,
      {},
      HOME_FEED_TIMEOUT_MS
    );
    if (!response.ok) {
      throw new Error(payload?.detail || 'Could not load product feed.');
    }

    (payload?.products || []).forEach((product) => {
      grid.appendChild(productCard(product));
    });

    if (currentGenderFilter) {
      setStatus(t(currentLanguage, 'status_showing_gender', { gender: currentGenderFilter }));
    } else {
      setStatus(t(currentLanguage, 'status_browse_start'));
    }
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function runSearch(event) {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) {
    setStatus(t(currentLanguage, 'status_no_query'), true);
    return;
  }

  setStatus(t(currentLanguage, 'status_searching'));

  try {
    const { response, payload } = await fetchJsonWithTimeout(withLangPath('/api/search', currentLanguage), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        shopper_name: SHOPPER_NAME,
        top_k: 10,
        lang: currentLanguage,
      }),
    });
    if (!response.ok) {
      throw new Error(payload?.detail || 'Search failed.');
    }

    const sessionId = payload?.session?.session_id;
    if (!sessionId) {
      throw new Error('Search completed but no session was generated.');
    }

    window.location.href = `/personalized?session=${encodeURIComponent(sessionId)}&lang=${encodeURIComponent(currentLanguage)}`;
  } catch (error) {
    setStatus(error.message, true);
  }
}

function openUploadModal() {
  if (uploadModal) {
    uploadModal.showModal();
  }
}

function closeUploadModal() {
  if (uploadModal) {
    uploadModal.close();
  }
}

async function runImageMatch(event) {
  event.preventDefault();
  if (!imageInput.files?.length) {
    setStatus(t(currentLanguage, 'choose_image'), true);
    return;
  }

  const originalFile = imageInput.files[0];
  const uploadFile = await optimizeImageForUpload(originalFile);
  const formData = new FormData();
  formData.append('image', uploadFile);
  formData.append('shopper_name', SHOPPER_NAME);
  formData.append('top_k', '10');
  formData.append('lang', currentLanguage);

  closeUploadModal();
  if (uploadFile !== originalFile) {
    setStatus(t(currentLanguage, 'status_image_optimized'));
  } else {
    setStatus(t(currentLanguage, 'status_image_running'));
  }

  try {
    const { response, payload } = await fetchJsonWithTimeout(
      withLangPath('/api/image-match', currentLanguage),
      {
        method: 'POST',
        body: formData,
      },
      IMAGE_MATCH_TIMEOUT_MS
    );
    if (!response.ok) {
      throw new Error(payload?.detail || 'Image matching failed.');
    }

    const sessionId = payload?.session?.session_id;
    if (!sessionId) {
      throw new Error('Image matched but no recommendation session was generated.');
    }

    window.location.href = `/personalized?session=${encodeURIComponent(sessionId)}&lang=${encodeURIComponent(currentLanguage)}`;
  } catch (error) {
    setStatus(error.message, true);
  }
}

function setGenderFilter(nextGender) {
  currentGenderFilter = normalizeGender(nextGender);
  updateUrlGenderFilter();
  updateNavSelection();
  loadHomeProducts();
}

function handleGenderClick(event) {
  event.preventDefault();
  setGenderFilter(event.currentTarget.dataset.gender || '');
}

function handleHomeClick(event) {
  if (!currentGenderFilter) {
    return;
  }
  event.preventDefault();
  setGenderFilter(null);
}

function registerDialogOutsideClose(dialog, onClose) {
  if (!dialog) {
    return;
  }
  dialog.addEventListener('click', (event) => {
    const rect = dialog.getBoundingClientRect();
    const withinDialog =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!withinDialog) {
      onClose();
    }
  });
}

function initializeLanguageSelector() {
  if (!languageSelect) {
    return;
  }
  const options = languageOptions()
    .map((option) => `<option value="${option.code}">${option.flag} ${option.label}</option>`)
    .join('');
  languageSelect.innerHTML = options;
  languageSelect.value = currentLanguage;

  languageSelect.addEventListener('change', () => {
    const nextLanguage = normalizeLanguage(languageSelect.value);
    if (nextLanguage === currentLanguage) {
      return;
    }
    currentLanguage = nextLanguage;
    persistLanguage(currentLanguage);
    applyStaticLanguage();
    updateUrlForLanguage();
    updateNavSelection();
    loadHomeProducts();
  });
}

searchForm?.addEventListener('submit', runSearch);
refreshButton?.addEventListener('click', loadHomeProducts);
cameraButton?.addEventListener('click', openUploadModal);
closeModalButton?.addEventListener('click', closeUploadModal);
uploadForm?.addEventListener('submit', runImageMatch);
voiceButton?.addEventListener('click', toggleVoiceCapture);
homeNavLink?.addEventListener('click', handleHomeClick);
genderNavLinks.forEach((link) => {
  link.addEventListener('click', handleGenderClick);
});
cartButton?.addEventListener('click', openCartModal);
profileButton?.addEventListener('click', openProfileModal);
closeCartModalButton?.addEventListener('click', closeCartModal);
closeProfileModalButton?.addEventListener('click', closeProfileModal);
closeInfoModalButton?.addEventListener('click', closeInfoModal);
footerLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    const slug = event.currentTarget?.dataset?.contentSlug;
    if (slug) {
      openInfoModal(slug);
    }
  });
});

registerDialogOutsideClose(uploadModal, closeUploadModal);
registerDialogOutsideClose(profileModal, closeProfileModal);
registerDialogOutsideClose(cartModal, closeCartModal);
registerDialogOutsideClose(infoModal, closeInfoModal);

persistLanguage(currentLanguage);
initializeLanguageSelector();
applyStaticLanguage();
updateUrlForLanguage();
updateNavSelection();
loadHomeProducts();
