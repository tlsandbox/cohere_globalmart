const grid = document.getElementById('home-grid');
const statusText = document.getElementById('status-text');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const voiceButton = document.getElementById('voice-button');
const refreshButton = document.getElementById('refresh-button');
const homeNavLink = document.getElementById('nav-home');
const genderNavLinks = Array.from(document.querySelectorAll('.top-nav a[data-gender]'));

const uploadModal = document.getElementById('upload-modal');
const cameraButton = document.getElementById('camera-button');
const closeModalButton = document.getElementById('close-modal');
const uploadForm = document.getElementById('upload-form');
const imageInput = document.getElementById('image-input');

const params = new URLSearchParams(window.location.search);
let currentGenderFilter = normalizeGender(params.get('gender'));
const HOME_FEED_TIMEOUT_MS = 20000;
const API_TIMEOUT_MS = 45000;

let mediaRecorder = null;
let recorderStream = null;
let recordingChunks = [];
let recordingStopTimer = null;
let speechRecognition = null;
let speechRecognitionActive = false;

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

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle('error', isError);
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

function stopBrowserSpeechRecognition() {
  if (speechRecognition && speechRecognitionActive) {
    speechRecognition.stop();
  }
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
    if (errorCode === 'no-speech') {
      setStatus('No speech detected. Please try again.', true);
      return;
    }
    setStatus(`Voice transcription failed (${errorCode}). Please try again.`, true);
  };

  speechRecognition.onend = () => {
    speechRecognitionActive = false;
    setVoiceButtonState(false);
    const text = (finalTranscript || searchInput.value || '').trim();
    if (!text) {
      setStatus('No speech detected. Please try again.', true);
      return;
    }
    searchInput.value = text;
    searchInput.focus();
    setStatus('Voice transcription complete. Edit text if needed, then press Find Items.');
  };

  speechRecognition.start();
  return true;
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
  if (currentGenderFilter) {
    url.searchParams.set('gender', currentGenderFilter);
  } else {
    url.searchParams.delete('gender');
  }
  window.history.replaceState({}, '', `${url.pathname}${url.search}`);
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
    30000
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

async function startVoiceCapture() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    setStatus('Voice capture is not supported in this browser.', true);
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
        setStatus(error.message, true);
      }
    });

    mediaRecorder.start();
    setVoiceButtonState(true);
    setStatus('Listening... click the mic again to stop.');

    recordingStopTimer = setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    }, 8000);
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
    startBrowserSpeechRecognition();
    return;
  }

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopVoiceCapture();
    return;
  }
  startVoiceCapture();
}

function productCard(product) {
  const article = document.createElement('article');
  article.className = 'product-card';

  article.innerHTML = `
    <img src="${product.image_url}" alt="${product.name}" loading="lazy" />
    <div class="product-copy">
      <h4>${product.name}</h4>
      <div class="product-meta">
        <span>${product.gender}</span>
        <span>${product.article_type}</span>
        <span>${product.base_colour}</span>
        <span>${product.usage || 'Lifestyle'}</span>
      </div>
      <p class="product-desc">${product.master_category} / ${product.sub_category} | Season: ${product.season || 'All'} | Year: ${product.year || 'n/a'}</p>
    </div>
  `;

  return article;
}

async function loadHomeProducts() {
  const filterLabel = currentGenderFilter ? `${currentGenderFilter} catalog selections` : 'catalog selections';
  setStatus(`Loading ${filterLabel}...`);
  grid.innerHTML = '';

  try {
    const requestUrl = new URL('/api/home-products', window.location.origin);
    requestUrl.searchParams.set('limit', '24');
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
      setStatus(`Showing ${currentGenderFilter} products. You can still run search or image upload.`);
    } else {
      setStatus('Browse and start with a natural-language query or image upload.');
    }
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function runSearch(event) {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) {
    setStatus('Please enter a search query first.', true);
    return;
  }

  setStatus('Outfit Assistant AI is searching similar items...');

  try {
    const { response, payload } = await fetchJsonWithTimeout('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        shopper_name: 'GlobalMart Fashion Shopper',
        top_k: 10,
      }),
    });
    if (!response.ok) {
      throw new Error(payload?.detail || 'Search failed.');
    }

    const sessionId = payload?.session?.session_id;
    if (!sessionId) {
      throw new Error('Search completed but no session was generated.');
    }

    window.location.href = `/personalized?session=${encodeURIComponent(sessionId)}`;
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
    setStatus('Please choose an image before uploading.', true);
    return;
  }

  const formData = new FormData();
  formData.append('image', imageInput.files[0]);
  formData.append('shopper_name', 'GlobalMart Fashion Shopper');
  formData.append('top_k', '10');

  closeUploadModal();
  setStatus('Analyzing image and matching catalog items...');

  try {
    const { response, payload } = await fetchJsonWithTimeout(
      '/api/image-match',
      {
        method: 'POST',
        body: formData,
      },
      60000
    );
    if (!response.ok) {
      throw new Error(payload?.detail || 'Image matching failed.');
    }

    const sessionId = payload?.session?.session_id;
    if (!sessionId) {
      throw new Error('Image matched but no recommendation session was generated.');
    }

    window.location.href = `/personalized?session=${encodeURIComponent(sessionId)}`;
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

if (uploadModal) {
  uploadModal.addEventListener('click', (event) => {
    const rect = uploadModal.getBoundingClientRect();
    const withinDialog =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    if (!withinDialog) {
      closeUploadModal();
    }
  });
}

updateNavSelection();
loadHomeProducts();
