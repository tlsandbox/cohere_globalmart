// Personalized page controller: renders recommendations, AI explain, and complete-the-look suggestions.

import {
  initialLanguage,
  languageOptions,
  normalizeLanguage,
  persistLanguage,
  t,
  withLangHref,
  withLangPath,
} from '/static/i18n.js';

const statusText = document.getElementById('status-text');
const assistantNote = document.getElementById('assistant-note');
const grid = document.getElementById('recommendation-grid');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const voiceButton = document.getElementById('voice-button');
const completeLookGrid = document.getElementById('complete-look-grid');
const completeLookNote = document.getElementById('complete-look-note');
const completeLookSection = document.getElementById('complete-look-section');

const uploadModal = document.getElementById('upload-modal');
const cameraButton = document.getElementById('camera-button');
const closeModalButton = document.getElementById('close-modal');
const uploadForm = document.getElementById('upload-form');
const imageInput = document.getElementById('image-input');

const cartButton = document.getElementById('cart-button');
const profileButton = document.getElementById('profile-button');
const languageSelect = document.getElementById('language-select');
const footerLinks = Array.from(document.querySelectorAll('.site-footer a[data-content-slug]'));
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
let currentSessionId = params.get('session');
let currentLanguage = initialLanguage(params);
let suggestOnlyMode = params.get('focus') === 'suggest';
const completeLookAnchorParam = Number(params.get('complete_anchor'));
let pendingCompleteLookAnchor = Number.isInteger(completeLookAnchorParam) && completeLookAnchorParam > 0
  ? completeLookAnchorParam
  : null;
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
let currentSessionQuery = '';

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle('error', isError);
}

function updateUrlForLanguage() {
  const url = new URL(window.location.href);
  url.searchParams.set('lang', currentLanguage);
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
  setText('personalized-hero-title', 'personalized_hero_title');
  setText('recommended-title', 'recommended_items');
  setText('card-actions-hint', 'card_actions_hint');
  setText('complete-look-title', 'complete_look_title');
  setText('upload-modal-title', 'upload_title');
  setText('upload-modal-desc', 'upload_desc');
  setText('upload-label', 'choose_image');
  setText('upload-submit', 'upload_and_match');
  setText('profile-modal-title', 'profile');
  setText('cart-modal-title', 'your_cart');

  searchInput.placeholder = t(currentLanguage, 'search_placeholder_personalized');
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
    const current = new URL(window.location.href);
    const sessionId = current.searchParams.get('session');
    const base = sessionId ? `/personalized?session=${encodeURIComponent(sessionId)}` : '/personalized';
    navPersonalized.setAttribute('href', withLangHref(base, currentLanguage));
  }

  localizeFooter();
}

function initializeLanguageSelector() {
  if (!languageSelect) {
    return;
  }
  languageSelect.innerHTML = languageOptions()
    .map(
      (option) =>
        `<option value="${option.code}" title="${option.label}" aria-label="${option.label}">${option.flag}</option>`
    )
    .join('');
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
    loadPersonalized(currentSessionId);
  });
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

function stopBrowserSpeechRecognition() {
  if (speechRecognition && speechRecognitionActive) {
    speechRecognition.stop();
  }
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
  setStatus('Listening... speak clearly, then pause to finish.');

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
    setStatus('Voice transcription complete. Edit text if needed, then press Find Items.');
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
        setStatus('Voice transcription complete. Edit text if needed, then press Find Items.');
      } catch (error) {
        setStatus(`${error.message} You can continue with typed search or image upload.`, true);
      }
    });

    mediaRecorder.start();
    setVoiceButtonState(true);
    setStatus('Listening with audio fallback... click the mic again to stop.');

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

function normalizedChips(chips, fallback = '') {
  if (Array.isArray(chips)) {
    const cleaned = chips
      .map((chip) => String(chip || '').trim())
      .filter(Boolean)
      .flatMap((chip) => chip.replace(/([a-z])([A-Z])/g, '$1|$2').split('|'))
      .map((chip) => chip.trim())
      .filter(Boolean);
    if (cleaned.length) {
      return cleaned;
    }
  }

  const fallbackText = String(fallback || '').trim();
  if (!fallbackText) {
    return [];
  }
  return fallbackText
    .replace(/([a-z])([A-Z])/g, '$1|$2')
    .split('|')
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizedText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryMatchSignals(product) {
  const queryNorm = normalizedText(currentSessionQuery);
  if (!queryNorm) {
    return [];
  }

  const padded = ` ${queryNorm} `;
  const checks = [
    { key: product.gender, label: t(currentLanguage, 'query_match_gender', { value: product.gender }) },
    { key: product.article_type, label: t(currentLanguage, 'query_match_item_type', { value: product.article_type }) },
    { key: product.base_colour, label: t(currentLanguage, 'query_match_color', { value: product.base_colour }) },
    { key: product.usage, label: t(currentLanguage, 'query_match_occasion', { value: product.usage }) },
    { key: product.season, label: t(currentLanguage, 'query_match_season', { value: product.season }) },
  ];

  const matches = [];
  checks.forEach(({ key, label }) => {
    const keyNorm = normalizedText(key);
    if (keyNorm && padded.includes(` ${keyNorm} `)) {
      matches.push(label);
    }
  });

  if (!matches.length) {
    const productBlob = normalizedText(
      [product.name, product.article_type, product.base_colour, product.usage].filter(Boolean).join(' ')
    );
    const keywordHits = queryNorm
      .split(' ')
      .filter((token) => token.length > 3 && productBlob.includes(token))
      .slice(0, 3);
    if (keywordHits.length) {
      matches.push(t(currentLanguage, 'query_match_style_keywords', { value: keywordHits.join(', ') }));
    }
  }

  return matches.slice(0, 3);
}

function shortQueryLabel() {
  const query = String(currentSessionQuery || '').trim();
  if (!query) {
    return t(currentLanguage, 'query_latest_request');
  }
  if (query.length <= 72) {
    return `"${query}"`;
  }
  return `"${query.slice(0, 69)}..."`;
}

function scoreToPercent(score) {
  const raw = Number(score);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  if (raw <= 1) {
    return Math.max(1, Math.min(100, Math.round(raw * 100)));
  }
  if (raw <= 2) {
    return Math.max(50, Math.min(90, Math.round(50 + (raw - 1) * 40)));
  }
  if (raw <= 4) {
    return Math.max(90, Math.min(100, Math.round(90 + ((raw - 2) / 2) * 10)));
  }
  return 100;
}

function scoreBarMarkup(score, label) {
  const percent = scoreToPercent(score);
  const safeLabel = escapeHtml(label);
  return `
    <div class="match-score" role="img" aria-label="${safeLabel} ${percent} percent">
      <div class="match-score-head">
        <span>${safeLabel}</span>
        <strong>${percent}%</strong>
      </div>
      <div class="match-score-track">
        <span class="match-score-fill" style="width: ${percent}%"></span>
      </div>
    </div>
  `;
}

function aiExplainModel(product, safeChips) {
  const querySignals = queryMatchSignals(product);
  const conciseReason = querySignals.length ? querySignals.join(', ') : t(currentLanguage, 'reason_overall_fit');
  const userFacingReasons = safeChips
    .filter((value) => {
      const normalized = String(value || '').toLowerCase();
      return !normalized.includes('keyword') && !normalized.includes('semantic') && !normalized.includes('rerank');
    })
    .map((value) => reasonToDisplayText(value))
    .slice(0, 2);

  const lines = [
    t(currentLanguage, 'ai_explain_query_matched', { reason: conciseReason }),
    t(currentLanguage, 'ai_explain_selection_default'),
  ];
  if (userFacingReasons.length) {
    lines[1] = t(currentLanguage, 'ai_explain_selection_with_reasons', {
      reasons: userFacingReasons.join(', '),
    });
  }

  return {
    heading: t(currentLanguage, 'ai_explain_heading', { query: shortQueryLabel() }),
    lines,
  };
}

function buildSuggestActionLabel() {
  return t(currentLanguage, 'suggest');
}

async function sendFeedback(eventType, productId = null, eventValue = null) {
  try {
    await fetchJsonWithTimeout(withLangPath('/api/feedback', currentLanguage), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        shopper_name: SHOPPER_NAME,
        event_type: eventType,
        session_id: currentSessionId,
        product_id: productId,
        event_value: eventValue,
      }),
    });
  } catch (_error) {
    // Feedback should not block the UX.
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
      <p><strong>Preferred gender:</strong> ${escapeHtml(payload.preferred_gender)}</p>
      <p><strong>Favorite color:</strong> ${escapeHtml(payload.favorite_color)}</p>
      <p><strong>Favorite article:</strong> ${escapeHtml(payload.favorite_article_type)}</p>
      <p><strong>${escapeHtml(t(currentLanguage, 'cart'))}:</strong> ${Number(payload.cart_items || 0)}</p>
      <p class="product-desc">Signals collected: clicks ${Number(payload.click_events || 0)}, cart adds ${Number(
        payload.cart_add_events || 0
      )}.</p>
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

function reasonToDisplayText(reason) {
  const value = String(reason || '').trim();
  if (!value) {
    return '';
  }
  const normalized = value.toLowerCase();
  if (normalized.includes('keyword')) {
    return t(currentLanguage, 'reason_keyword_relevance');
  }
  if (normalized.includes('semantic')) {
    return t(currentLanguage, 'reason_semantic_similarity');
  }
  if (normalized.includes('rerank') || normalized.includes('cohere')) {
    return t(currentLanguage, 'reason_cohere_rerank');
  }
  if (normalized.includes('gender')) {
    return t(currentLanguage, 'reason_gender_aligned');
  }
  if (normalized.includes('article')) {
    return t(currentLanguage, 'reason_article_type_match');
  }
  if (normalized.includes('color')) {
    return t(currentLanguage, 'reason_color_preference_match');
  }
  if (normalized.includes('season')) {
    return t(currentLanguage, 'reason_season_aligned');
  }
  if (normalized.includes('occasion') || normalized.includes('usage')) {
    return t(currentLanguage, 'reason_usage_aligned');
  }
  if (normalized.includes('recent')) {
    return t(currentLanguage, 'reason_recency_boost');
  }
  return value;
}

function hybridExplainPayload(product, safeChips) {
  const explain = aiExplainModel(product, safeChips);
  return explain;
}

function productCard(product) {
  const article = document.createElement('article');
  article.className = 'product-card interactive-card';

  const safeChips = normalizedChips(product.explanation_chips || [], product.explanation || '');
  article.innerHTML = `
    <img src="${product.image_url}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async" />
    <div class="product-copy">
      <h4>#${Number(product.rank)} ${escapeHtml(product.name)}</h4>
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
        <button class="feature-action explain-button" type="button" title="${escapeHtml(t(currentLanguage, 'explain'))}">${escapeHtml(t(currentLanguage, 'explain'))}</button>
        <button class="feature-action complete-look-button" type="button" title="${escapeHtml(t(currentLanguage, 'suggest'))}">${buildSuggestActionLabel()}</button>
        <button class="feature-action add-cart-button" type="button" title="${escapeHtml(t(currentLanguage, 'buy'))}">${escapeHtml(t(currentLanguage, 'buy'))}</button>
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
    sendFeedback('click', Number(product.id), 'personalized_card_click');
  });

  const explainButton = article.querySelector('.explain-button');
  const lookButton = article.querySelector('.complete-look-button');
  const addCartButton = article.querySelector('.add-cart-button');
  const explainPayload = hybridExplainPayload(product, safeChips);

  explainButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    const existing = article.querySelector('.ai-explain');
    if (existing) {
      existing.remove();
      return;
    }
    const explain = document.createElement('div');
    explain.className = 'ai-explain';
    explain.innerHTML = `
      <p class="product-desc"><strong>${escapeHtml(t(currentLanguage, 'ai_explain_title'))}:</strong> ${escapeHtml(explainPayload.heading)}</p>
      ${scoreBarMarkup(product.score, t(currentLanguage, 'ai_explain_score_label'))}
      <ul class="ai-explain-list">
        ${explainPayload.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
      </ul>
    `;
    article.querySelector('.product-copy')?.appendChild(explain);
  });

  lookButton?.addEventListener('click', async (event) => {
    event.stopPropagation();
    lookButton.disabled = true;
    try {
      await runCompleteTheLook(product.id);
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      lookButton.disabled = false;
    }
  });

  addCartButton?.addEventListener('click', async (event) => {
    event.stopPropagation();
    addCartButton.disabled = true;
    try {
      await addToCart(Number(product.id));
      setStatus(t(currentLanguage, 'status_added_cart'));
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      addCartButton.disabled = false;
    }
  });

  return article;
}

function completeLookCard(product) {
  const article = document.createElement('article');
  article.className = 'product-card compact-card';

  article.innerHTML = `
    <img src="${product.image_url}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async" />
    <div class="product-copy">
      <h4>#${Number(product.rank)} ${escapeHtml(product.name)}</h4>
      <div class="product-meta">
        <span>${escapeHtml(product.article_type)}</span>
        <span>${escapeHtml(product.base_colour)}</span>
      </div>
      <p class="product-desc"><strong>${escapeHtml(t(currentLanguage, 'why_suggested'))}:</strong> ${escapeHtml(product.explanation || 'Recommended as a compatible piece for your selected item.')}</p>
      ${scoreBarMarkup(product.score, t(currentLanguage, 'suggest_fit_score_label'))}
    </div>
  `;

  const image = article.querySelector('img');
  attachImageFallback(image);
  return article;
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
}

function renderRecommendations(payload) {
  const recommendations = payload.recommendations || [];
  grid.innerHTML = '';

  if (!recommendations.length) {
    assistantNote.textContent = t(currentLanguage, 'personalized_hero_note');
    setStatus('No recommendations available for this session.', true);
    return;
  }

  const source = payload.session?.source || 'unknown flow';
  currentSessionQuery = String(payload.session?.query_text || '').trim();
  assistantNote.textContent = payload.assistant_note || `GlobalMart Fashion AI powered by Cohere generated these picks from ${source}.`;

  recommendations.forEach((product) => {
    grid.appendChild(productCard(product));
  });

  setStatus(t(currentLanguage, 'status_use_actions'));
}

async function loadPersonalized(sessionId) {
  if (completeLookGrid) {
    completeLookGrid.innerHTML = '';
  }
  if (completeLookNote) {
    completeLookNote.textContent = t(currentLanguage, 'complete_look_note');
  }

  if (!sessionId) {
    grid.innerHTML = '';
    assistantNote.textContent = t(currentLanguage, 'personalized_hero_note');
    setStatus('No recommendation session yet. Start from Home with search or image upload.', true);
    return;
  }

  if (suggestOnlyMode && pendingCompleteLookAnchor) {
    grid.innerHTML = '';
    assistantNote.textContent = 'Suggest mode from Home feed.';
    currentSessionQuery = '';
    const productId = pendingCompleteLookAnchor;
    pendingCompleteLookAnchor = null;
    window.history.replaceState({}, '', `/personalized?session=${encodeURIComponent(sessionId)}&lang=${encodeURIComponent(currentLanguage)}`);
    await runCompleteTheLook(productId);
    suggestOnlyMode = false;
    return;
  }

  setStatus(t(currentLanguage, 'status_loading_personalized'));

  try {
    const { response, payload } = await fetchJsonWithTimeout(
      withLangPath(`/api/personalized/${encodeURIComponent(sessionId)}`, currentLanguage),
      {},
      30000
    );

    if (!response.ok) {
      throw new Error(payload?.detail || 'Could not load personalized recommendations.');
    }

    renderRecommendations(payload);
    if (pendingCompleteLookAnchor) {
      const productId = pendingCompleteLookAnchor;
      pendingCompleteLookAnchor = null;
      window.history.replaceState({}, '', `/personalized?session=${encodeURIComponent(currentSessionId || sessionId)}&lang=${encodeURIComponent(currentLanguage)}`);
      await runCompleteTheLook(productId);
    }
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function runCompleteTheLook(productId) {
  if (!currentSessionId) {
    throw new Error('No session available. Run a search or upload first.');
  }
  if (!Number.isInteger(Number(productId)) || Number(productId) <= 0) {
    throw new Error('Invalid product selection for complete-the-look.');
  }

  setStatus(t(currentLanguage, 'status_generate_suggest'));

  const { response, payload } = await fetchJsonWithTimeout(withLangPath('/api/complete-look', currentLanguage), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session_id: currentSessionId,
      product_id: Number(productId),
      top_k: 6,
      lang: currentLanguage,
    }),
  });
  if (!response.ok) {
    throw new Error(payload?.detail || 'Complete-the-look generation failed.');
  }

  if (completeLookNote) {
    completeLookNote.textContent =
      payload?.assistant_note ||
      `Suggestions are chosen to pair with your selected item using color, category, and occasion compatibility.`;
  }
  if (completeLookGrid) {
    completeLookGrid.innerHTML = '';
    const recs = payload?.recommendations || [];
    if (!recs.length) {
      completeLookGrid.innerHTML = '<p class="product-desc">No compatible add-on items were found for this product.</p>';
    }
    recs.forEach((product) => {
      completeLookGrid.appendChild(completeLookCard(product));
    });
  }

  await sendFeedback('complete_look', Number(productId), 'personalized_card');
  completeLookSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setStatus(t(currentLanguage, 'status_suggest_ready'));
}

async function runSearch(event) {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) {
    setStatus(t(currentLanguage, 'status_no_query'), true);
    return;
  }

  setStatus(t(currentLanguage, 'status_run_search'));

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

    currentSessionId = payload?.session?.session_id;
    if (!currentSessionId) {
      throw new Error('Search completed but no session returned.');
    }

    suggestOnlyMode = false;
    pendingCompleteLookAnchor = null;
    window.history.replaceState({}, '', `/personalized?session=${encodeURIComponent(currentSessionId)}&lang=${encodeURIComponent(currentLanguage)}`);
    renderRecommendations(payload);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function openUploadModal() {
  uploadModal?.showModal();
}

function closeUploadModal() {
  uploadModal?.close();
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
      throw new Error(payload?.detail || 'Image match failed.');
    }

    currentSessionId = payload?.session?.session_id;
    if (!currentSessionId) {
      throw new Error('Image matching completed but no session returned.');
    }

    suggestOnlyMode = false;
    pendingCompleteLookAnchor = null;
    window.history.replaceState({}, '', `/personalized?session=${encodeURIComponent(currentSessionId)}&lang=${encodeURIComponent(currentLanguage)}`);
    renderRecommendations(payload);
  } catch (error) {
    setStatus(error.message, true);
  }
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

searchForm?.addEventListener('submit', runSearch);
cameraButton?.addEventListener('click', openUploadModal);
closeModalButton?.addEventListener('click', closeUploadModal);
uploadForm?.addEventListener('submit', runImageMatch);
voiceButton?.addEventListener('click', toggleVoiceCapture);

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
loadPersonalized(currentSessionId);
