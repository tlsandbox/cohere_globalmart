const statusText = document.getElementById('status-text');
const assistantNote = document.getElementById('assistant-note');
const grid = document.getElementById('recommendation-grid');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const voiceButton = document.getElementById('voice-button');

const uploadModal = document.getElementById('upload-modal');
const cameraButton = document.getElementById('camera-button');
const closeModalButton = document.getElementById('close-modal');
const uploadForm = document.getElementById('upload-form');
const imageInput = document.getElementById('image-input');
const matchModal = document.getElementById('match-modal');
const matchModalTitle = document.getElementById('match-modal-title');
const matchModalContent = document.getElementById('match-modal-content');
const closeMatchModalButton = document.getElementById('close-match-modal');

const params = new URLSearchParams(window.location.search);
let currentSessionId = params.get('session');
const API_TIMEOUT_MS = 45000;
let mediaRecorder = null;
let recorderStream = null;
let recordingChunks = [];
let recordingStopTimer = null;
let speechRecognition = null;
let speechRecognitionActive = false;

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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatValueList(values) {
  if (!Array.isArray(values) || !values.length) {
    return '';
  }
  return values.map((value) => escapeHtml(value)).join(', ');
}

function renderJudgementDetails(details) {
  if (!details || !Array.isArray(details.details)) {
    return '';
  }

  const rows = details.details.filter((row) => row && row.status && row.status !== 'Not specified');
  if (!rows.length) {
    return '';
  }

  const listItems = rows
    .map((row) => {
      const attribute = escapeHtml(row.attribute || 'Signal');
      const status = escapeHtml(row.status || 'Missing');
      const expected = escapeHtml(row.expected || 'Not specified');
      const actual = escapeHtml(row.actual || 'Unknown');
      const reason = escapeHtml(row.reason || '');
      const matchedValues = formatValueList(row.matched_values);
      const missingValues = formatValueList(row.missing_values);
      const score = typeof row.score === 'number' ? Math.round(row.score * 100) : null;
      const scoreText = score === null ? '' : `<br />Signal score: ${score}%`;
      const matchedText = matchedValues ? `<br />Matched cues: ${matchedValues}` : '';
      const missingText = missingValues ? `<br />Missing cues: ${missingValues}` : '';
      const reasonText = reason ? `<br />Judgement: ${reason}` : '';
      return `
        <li>
          <strong>${attribute} (${status})</strong>: expected ${expected}; got ${actual}
          ${scoreText}${matchedText}${missingText}${reasonText}
        </li>
      `;
    })
    .join('');

  const ratio = `${details.matched_count || 0}/${details.active_count || rows.length}`;
  return `
    <div class="match-judgement">
      <p class="product-desc"><strong>Signal alignment:</strong> ${ratio}</p>
      <ul class="match-breakdown">${listItems}</ul>
    </div>
  `;
}

function renderMatchModalBody(productName, payload) {
  const verdict = escapeHtml(payload?.verdict || 'Possible match');
  const confidenceValue = typeof payload?.confidence === 'number' ? Math.round(payload.confidence * 100) : null;
  const confidence = confidenceValue === null ? '' : ` (${confidenceValue}%)`;
  const rationale = escapeHtml(payload?.rationale || 'No explanation available.');
  const details = payload?.judgement_details;

  let detailMarkup = '<p class="product-desc">No detailed signal breakdown available.</p>';
  if (details && Array.isArray(details.details)) {
    const rows = details.details.filter((row) => row && row.status && row.status !== 'Not specified');
    if (rows.length) {
      const listItems = rows
        .map((row) => {
          const attribute = escapeHtml(row.attribute || 'Signal');
          const status = escapeHtml(row.status || 'Missing');
          const expected = escapeHtml(row.expected || 'Not specified');
          const actual = escapeHtml(row.actual || 'Unknown');
          const note = escapeHtml(row.note || '');
          const reason = escapeHtml(row.reason || '');
          const matchedValues = formatValueList(row.matched_values);
          const missingValues = formatValueList(row.missing_values);
          const score = typeof row.score === 'number' ? Math.round(row.score * 100) : null;
          return `
            <li>
              <strong>${attribute} (${status})</strong><br />
              Expected: ${expected}<br />
              Product: ${actual}
              ${score === null ? '' : `<br />Signal score: ${score}%`}
              ${matchedValues ? `<br />Matched cues: ${matchedValues}` : ''}
              ${missingValues ? `<br />Missing cues: ${missingValues}` : ''}
              ${reason ? `<br />Judgement: ${reason}` : ''}
              ${note ? `<br />Why it matters: ${note}` : ''}
            </li>
          `;
        })
        .join('');

      const ratio = `${details.matched_count || 0}/${details.active_count || rows.length}`;
      detailMarkup = `
        <p class="product-desc"><strong>Signal alignment:</strong> ${ratio}</p>
        <ul class="match-breakdown">${listItems}</ul>
      `;
    }
  }

  return `
    <p class="product-desc"><strong>Selected product:</strong> ${escapeHtml(productName)}</p>
    <p class="product-desc"><strong>Result:</strong> ${verdict}${confidence}</p>
    <p class="product-desc">${rationale}</p>
    ${detailMarkup}
  `;
}

function openMatchModal(productName, payload) {
  if (!matchModal || !matchModalTitle || !matchModalContent) {
    return;
  }

  matchModalTitle.textContent = `Check Your Match: ${productName}`;
  matchModalContent.innerHTML = renderMatchModalBody(productName, payload);
  matchModal.showModal();
}

function matchBlock(match) {
  if (!match) {
    return '';
  }

  const confidence = typeof match.confidence === 'number' ? ` (${Math.round(match.confidence * 100)}%)` : '';
  return `
    <div class="match-result">
      <strong>${match.verdict}${confidence}</strong>
      <p class="product-desc">${match.rationale}</p>
    </div>
  `;
}

function productCard(product) {
  const article = document.createElement('article');
  article.className = 'product-card';

  article.innerHTML = `
    <img src="${product.image_url}" alt="${product.name}" loading="lazy" />
    <div class="product-copy">
      <h4>#${product.rank} ${product.name}</h4>
      <div class="product-meta">
        <span>${product.gender}</span>
        <span>${product.article_type}</span>
        <span>${product.base_colour}</span>
        <span>${product.usage || 'Lifestyle'}</span>
      </div>
      <p class="product-desc">${product.master_category} / ${product.sub_category} | Season: ${product.season || 'All'} | Year: ${product.year || 'n/a'} | Similarity: ${product.score.toFixed(3)}</p>
      <button class="match-button" data-product-id="${product.id}">Check Your Match</button>
      ${matchBlock(product.match)}
    </div>
  `;

  const button = article.querySelector('.match-button');
  button?.addEventListener('click', () => runCheckMatch(product, button, article));

  return article;
}

async function loadPersonalized(sessionId) {
  grid.innerHTML = '';

  if (!sessionId) {
    assistantNote.textContent = 'Try searching or uploading something first to generate your personalized items.';
    setStatus('No recommendation session yet. Start from Home with search or image upload.', true);
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

    const recommendations = payload.recommendations || [];
    if (!recommendations.length) {
      assistantNote.textContent = 'Try searching or uploading something first to generate your personalized items.';
      setStatus('No recommendations available for this session.', true);
      return;
    }

    const source = payload.session?.source || 'unknown flow';
    assistantNote.textContent = `GlobalMart Fashion AI powered by Cohere generated these picks from ${source}.`;

    recommendations.forEach((product) => {
      grid.appendChild(productCard(product));
    });

    setStatus('Review each recommendation and run Check Your Match for fit guidance.');
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function runCheckMatch(product, button, card) {
  if (!currentSessionId) {
    setStatus('No session available. Run a search or upload first.', true);
    return;
  }

  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = 'Checking...';

  try {
    const { response, payload } = await fetchJsonWithTimeout('/api/check-match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session_id: currentSessionId,
        product_id: product.id,
      }),
    });
    if (!response.ok) {
      throw new Error(payload?.detail || 'Match check failed.');
    }

    const existing = card.querySelector('.match-result');
    if (existing) {
      existing.remove();
    }

    const confidence = typeof payload.confidence === 'number' ? ` (${Math.round(payload.confidence * 100)}%)` : '';
    const breakdownMarkup = renderJudgementDetails(payload?.judgement_details);
    const div = document.createElement('div');
    div.className = 'match-result';
    div.innerHTML = `
      <strong>${escapeHtml(payload.verdict)}${confidence}</strong>
      <p class="product-desc">${escapeHtml(payload.rationale)}</p>
      ${breakdownMarkup}
    `;

    card.querySelector('.product-copy')?.appendChild(div);
    openMatchModal(product.name, payload);
    setStatus('Match check completed for selected item.');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
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
        shopper_name: 'GlobalMart Fashion Shopper',
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

    window.history.replaceState({}, '', `/personalized?session=${encodeURIComponent(currentSessionId)}`);
    loadPersonalized(currentSessionId);
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

  const formData = new FormData();
  formData.append('image', imageInput.files[0]);
  formData.append('shopper_name', 'GlobalMart Fashion Shopper');
  formData.append('top_k', '10');

  closeUploadModal();
  setStatus('Running image-upload-match flow...');

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
      throw new Error(payload?.detail || 'Image match failed.');
    }

    currentSessionId = payload?.session?.session_id;
    if (!currentSessionId) {
      throw new Error('Image matching completed but no session returned.');
    }

    window.history.replaceState({}, '', `/personalized?session=${encodeURIComponent(currentSessionId)}`);
    loadPersonalized(currentSessionId);
  } catch (error) {
    setStatus(error.message, true);
  }
}

searchForm?.addEventListener('submit', runSearch);
cameraButton?.addEventListener('click', openUploadModal);
closeModalButton?.addEventListener('click', closeUploadModal);
uploadForm?.addEventListener('submit', runImageMatch);
voiceButton?.addEventListener('click', toggleVoiceCapture);
closeMatchModalButton?.addEventListener('click', () => matchModal?.close());

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

if (matchModal) {
  matchModal.addEventListener('click', (event) => {
    const rect = matchModal.getBoundingClientRect();
    const withinDialog =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    if (!withinDialog) {
      matchModal.close();
    }
  });
}

loadPersonalized(currentSessionId);
