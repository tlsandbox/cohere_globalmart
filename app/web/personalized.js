// Personalized page controller: renders recommendations, AI explain, and complete-the-look suggestions.

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
  voiceButton.setAttribute(
    'aria-label',
    isRecording ? 'Stop recording and transcribe' : 'Voice to text'
  );
  voiceButton.title = isRecording ? 'Stop recording and transcribe' : 'Voice to text';
}

function speechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
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
  speechRecognition.lang = navigator.language || 'en-US';
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
    { key: product.gender, label: `gender: ${product.gender}` },
    { key: product.article_type, label: `item type: ${product.article_type}` },
    { key: product.base_colour, label: `color: ${product.base_colour}` },
    { key: product.usage, label: `occasion: ${product.usage}` },
    { key: product.season, label: `season: ${product.season}` },
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
      matches.push(`style keywords: ${keywordHits.join(', ')}`);
    }
  }

  return matches.slice(0, 3);
}

function shortQueryLabel() {
  const query = String(currentSessionQuery || '').trim();
  if (!query) {
    return 'your latest request';
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
  const conciseReason = querySignals.length ? querySignals.join(', ') : 'overall style intent and category fit';
  const userFacingReasons = safeChips
    .map((value) => reasonToDisplayText(value))
    .filter((value) => !['Keyword relevance', 'Semantic similarity', 'Cohere rerank'].includes(value))
    .slice(0, 2);

  const lines = [
    `Query matched: ${conciseReason}.`,
    `Selection logic: hybrid ranking blends exact keyword hits with style similarity.`,
  ];
  if (userFacingReasons.length) {
    lines[1] = `Selection logic: ${userFacingReasons.join(', ')} plus hybrid ranking across keyword and style similarity.`;
  }

  return {
    heading: `Matches ${shortQueryLabel()}`,
    lines,
  };
}

function buildSuggestActionLabel() {
  return 'Suggest';
}

async function sendFeedback(eventType, productId = null, eventValue = null) {
  try {
    await fetchJsonWithTimeout('/api/feedback', {
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
      `/api/profile?shopper_name=${encodeURIComponent(SHOPPER_NAME)}`
    );
    if (!response.ok) {
      throw new Error(payload?.detail || 'Could not load profile.');
    }
    profileContent.innerHTML = `
      <p><strong>Name:</strong> ${escapeHtml(payload.shopper_name)}</p>
      <p><strong>Tier:</strong> ${escapeHtml(payload.membership_tier)}</p>
      <p><strong>Preferred gender:</strong> ${escapeHtml(payload.preferred_gender)}</p>
      <p><strong>Favorite color:</strong> ${escapeHtml(payload.favorite_color)}</p>
      <p><strong>Favorite article:</strong> ${escapeHtml(payload.favorite_article_type)}</p>
      <p><strong>Cart items:</strong> ${Number(payload.cart_items || 0)}</p>
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
    cartContent.innerHTML = '<p class="product-desc">Your cart is empty.</p>';
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
                <p class="product-desc">Qty: ${Number(item.quantity || 1)}</p>
              </div>
              <button class="secondary-button cart-remove" data-product-id="${Number(item.id)}" type="button">Remove</button>
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
        await fetchJsonWithTimeout('/api/cart/remove', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            shopper_name: SHOPPER_NAME,
            product_id: productId,
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
      `/api/cart?shopper_name=${encodeURIComponent(SHOPPER_NAME)}`
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
    const { response, payload } = await fetchJsonWithTimeout(`/api/content/${encodeURIComponent(slug)}`);
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
    return 'Keyword relevance';
  }
  if (normalized.includes('semantic')) {
    return 'Semantic similarity';
  }
  if (normalized.includes('rerank') || normalized.includes('cohere')) {
    return 'Cohere rerank';
  }
  if (normalized.includes('gender')) {
    return 'Gender aligned';
  }
  if (normalized.includes('article')) {
    return 'Article type match';
  }
  if (normalized.includes('color')) {
    return 'Color preference match';
  }
  if (normalized.includes('season')) {
    return 'Season aligned';
  }
  if (normalized.includes('occasion') || normalized.includes('usage')) {
    return 'Usage aligned';
  }
  if (normalized.includes('recent')) {
    return 'Recency boost';
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
        <button class="feature-action explain-button" type="button" title="Explain why this item matches your query">Explain</button>
        <button class="feature-action complete-look-button" type="button" title="Suggest items to complete your look">${buildSuggestActionLabel()}</button>
        <button class="feature-action add-cart-button" type="button" title="Buy this item">Buy</button>
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
      <p class="product-desc"><strong>AI Explain:</strong> ${escapeHtml(explainPayload.heading)}</p>
      ${scoreBarMarkup(product.score, 'Query match')}
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
      setStatus('Added to cart.');
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
      <p class="product-desc"><strong>Why suggested:</strong> ${escapeHtml(product.explanation || 'Recommended as a compatible piece for your selected item.')}</p>
      ${scoreBarMarkup(product.score, 'Outfit fit')}
    </div>
  `;

  const image = article.querySelector('img');
  attachImageFallback(image);
  return article;
}

async function addToCart(productId) {
  const { response, payload } = await fetchJsonWithTimeout('/api/cart/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      shopper_name: SHOPPER_NAME,
      product_id: productId,
      quantity: 1,
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
    assistantNote.textContent = 'Try searching or uploading something first to generate your personalized items.';
    setStatus('No recommendations available for this session.', true);
    return;
  }

  const source = payload.session?.source || 'unknown flow';
  currentSessionQuery = String(payload.session?.query_text || '').trim();
  assistantNote.textContent = payload.assistant_note || `GlobalMart Fashion AI powered by Cohere generated these picks from ${source}.`;

  recommendations.forEach((product) => {
    grid.appendChild(productCard(product));
  });

  setStatus('Use Explain, Suggest, or Buy on each item.');
}

async function loadPersonalized(sessionId) {
  if (completeLookGrid) {
    completeLookGrid.innerHTML = '';
  }
  if (completeLookNote) {
    completeLookNote.textContent =
      'Select a recommendation and click Suggest to generate compatible outfit additions.';
  }

  if (!sessionId) {
    grid.innerHTML = '';
    assistantNote.textContent = 'Try searching or uploading something first to generate your personalized items.';
    setStatus('No recommendation session yet. Start from Home with search or image upload.', true);
    return;
  }

  if (suggestOnlyMode && pendingCompleteLookAnchor) {
    grid.innerHTML = '';
    assistantNote.textContent = 'Suggest mode from Home feed.';
    currentSessionQuery = '';
    const productId = pendingCompleteLookAnchor;
    pendingCompleteLookAnchor = null;
    window.history.replaceState({}, '', `/personalized?session=${encodeURIComponent(sessionId)}`);
    await runCompleteTheLook(productId);
    suggestOnlyMode = false;
    return;
  }

  setStatus('Loading your personalized recommendations...');

  try {
    const { response, payload } = await fetchJsonWithTimeout(
      `/api/personalized/${encodeURIComponent(sessionId)}`,
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
      window.history.replaceState({}, '', `/personalized?session=${encodeURIComponent(currentSessionId || sessionId)}`);
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

  setStatus('Generating complete-the-look recommendations...');

  const { response, payload } = await fetchJsonWithTimeout('/api/complete-look', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session_id: currentSessionId,
      product_id: Number(productId),
      top_k: 6,
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
  setStatus('Suggest results are ready below.');
}

async function runSearch(event) {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) {
    setStatus('Please enter a search query first.', true);
    return;
  }

  setStatus('Running natural-language-query-search...');

  try {
    const { response, payload } = await fetchJsonWithTimeout('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        shopper_name: SHOPPER_NAME,
        top_k: 10,
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
    window.history.replaceState({}, '', `/personalized?session=${encodeURIComponent(currentSessionId)}`);
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
    setStatus('Please choose an image before uploading.', true);
    return;
  }

  const originalFile = imageInput.files[0];
  const uploadFile = await optimizeImageForUpload(originalFile);
  const formData = new FormData();
  formData.append('image', uploadFile);
  formData.append('shopper_name', SHOPPER_NAME);
  formData.append('top_k', '10');

  closeUploadModal();
  if (uploadFile !== originalFile) {
    setStatus('Image optimized. Running image-upload-match flow...');
  } else {
    setStatus('Running image-upload-match flow...');
  }

  try {
    const { response, payload } = await fetchJsonWithTimeout(
      '/api/image-match',
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
    window.history.replaceState({}, '', `/personalized?session=${encodeURIComponent(currentSessionId)}`);
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

loadPersonalized(currentSessionId);
