// Shared multilingual helpers for GlobalMart Fashion UI and API language propagation.

export const LANGUAGE_STORAGE_KEY = 'gmf_language';

export const SUPPORTED_LANGUAGES = {
  en: { code: 'en', label: 'English', flag: '🇺🇸', locale: 'en-US' },
  ja: { code: 'ja', label: '日本語', flag: '🇯🇵', locale: 'ja-JP' },
  zh: { code: 'zh', label: '中文', flag: '🇨🇳', locale: 'zh-CN' },
  es: { code: 'es', label: 'Español', flag: '🇪🇸', locale: 'es-ES' },
};

const LANGUAGE_ALIASES = {
  en: 'en',
  'en-us': 'en',
  english: 'en',
  ja: 'ja',
  jp: 'ja',
  'ja-jp': 'ja',
  japanese: 'ja',
  zh: 'zh',
  'zh-cn': 'zh',
  'zh-hans': 'zh',
  chinese: 'zh',
  es: 'es',
  'es-es': 'es',
  spanish: 'es',
};

const STRINGS = {
  en: {
    brand_eyebrow: 'GlobalMart Fashion',
    brand_title: 'Outfit Assistant',
    nav_home: 'Home',
    nav_women: 'Women',
    nav_men: 'Men',
    nav_personalized: 'Your Personalized Item',
    search_placeholder_home: "Search in natural language, e.g. 'I need a modern navy look for a wedding'",
    search_placeholder_personalized: 'Ask for another look and refresh recommendations',
    find_items: 'Find Items',
    voice_title: 'Voice to text',
    image_upload_match: 'Image Upload Match',
    profile: 'Profile',
    cart: 'Cart',
    close: 'Close',
    cancel: 'Cancel',
    hero_title_home: 'AI-guided shopping for your next purchase',
    hero_desc_home:
      'Use natural-language search or upload an image. GlobalMart Fashion AI powered by Cohere finds similar, updated styles from private catalog data.',
    suggested_for_you: 'Suggested For You',
    refresh_feed: 'Refresh Feed',
    upload_title: 'Image Upload Match',
    upload_desc: 'Upload a JPG/PNG image and Outfit Assistant AI will recommend 10 similar items.',
    choose_image: 'Choose image',
    upload_and_match: 'Upload and Match',
    your_cart: 'Your Cart',
    info: 'Info',
    company: 'Company',
    assistance: 'Assistance',
    legal: 'Legal',
    follow_us: 'Follow Us',
    about: 'About GlobalMart Fashion',
    careers: 'Careers',
    stores: 'Stores',
    customer_service: 'Customer Service',
    delivery: 'Delivery',
    returns: 'Returns',
    terms: 'Terms and Conditions',
    privacy: 'Privacy Notice',
    cookies: 'Cookie Settings',
    instagram: 'Instagram',
    youtube: 'YouTube',
    linkedin: 'LinkedIn',
    personalized_hero_title: 'Your Personalized Item',
    personalized_hero_note: 'Try a search or image upload to generate personalized recommendations.',
    recommended_items: 'Recommended Items',
    card_actions_hint: 'Use card actions: Explain, Suggest, Buy.',
    complete_look_title: 'Complete the Look',
    complete_look_note: 'Select a recommendation and click Suggest to generate compatible outfit additions.',
    explain: 'Explain',
    suggest: 'Suggest',
    buy: 'Buy',
    quantity: 'Qty',
    remove: 'Remove',
    status_loading_catalog: 'Loading {label}...',
    status_showing_gender: 'Showing {gender} products. Use search, voice, image upload, or cart actions.',
    status_browse_start: 'Browse and start with a natural-language query, voice query, or image upload.',
    status_searching: 'Outfit Assistant AI is searching similar items...',
    status_no_query: 'Please enter a search query first.',
    status_added_cart: 'Added to cart.',
    status_prepare_suggest: 'Preparing suggest recommendations...',
    status_loading_personalized: 'Loading your personalized recommendations...',
    status_run_search: 'Running natural-language-query-search...',
    status_image_running: 'Running image-upload-match flow...',
    status_image_optimized: 'Image optimized. Running image-upload-match flow...',
    status_generate_suggest: 'Generating complete-the-look recommendations...',
    status_suggest_ready: 'Suggest results are ready below.',
    status_use_actions: 'Use Explain, Suggest, or Buy on each item.',
    empty_cart: 'Your cart is empty.',
  },
  ja: {
    brand_eyebrow: 'グローバルマート ファッション',
    brand_title: 'アウトフィット アシスタント',
    nav_home: 'ホーム',
    nav_women: 'レディース',
    nav_men: 'メンズ',
    nav_personalized: 'あなた向けおすすめ',
    search_placeholder_home: '自然言語で検索（例: 結婚式向けのモダンなネイビースタイル）',
    search_placeholder_personalized: '別のスタイルを入力しておすすめを更新',
    find_items: '検索',
    voice_title: '音声入力',
    image_upload_match: '画像アップロード',
    profile: 'プロフィール',
    cart: 'カート',
    close: '閉じる',
    cancel: 'キャンセル',
    hero_title_home: '次の購入に向けたAIショッピング',
    hero_desc_home:
      '自然言語検索または画像アップロードをご利用ください。Cohere搭載のGlobalMart Fashion AIが、プライベートな商品データから類似スタイルを提案します。',
    suggested_for_you: 'おすすめ',
    refresh_feed: '更新',
    upload_title: '画像アップロード',
    upload_desc: 'JPG/PNG画像をアップロードすると、AIが類似アイテムを10件提案します。',
    choose_image: '画像を選択',
    upload_and_match: 'アップロードして一致検索',
    your_cart: 'カート',
    info: '情報',
    company: '企業情報',
    assistance: 'サポート',
    legal: '法務',
    follow_us: 'フォロー',
    about: 'GlobalMart Fashionについて',
    careers: '採用情報',
    stores: '店舗',
    customer_service: 'カスタマーサービス',
    delivery: '配送',
    returns: '返品',
    terms: '利用規約',
    privacy: 'プライバシー',
    cookies: 'Cookie設定',
    instagram: 'Instagram',
    youtube: 'YouTube',
    linkedin: 'LinkedIn',
    personalized_hero_title: 'あなた向けおすすめ',
    personalized_hero_note: '検索または画像アップロードでおすすめを生成できます。',
    recommended_items: 'おすすめアイテム',
    card_actions_hint: 'カード操作: Explain / Suggest / Buy',
    complete_look_title: 'コーデを完成',
    complete_look_note: 'おすすめ商品でSuggestを押すと、相性の良い追加アイテムを提案します。',
    explain: 'Explain',
    suggest: 'Suggest',
    buy: 'Buy',
    quantity: '数量',
    remove: '削除',
    status_loading_catalog: '{label}を読み込み中...',
    status_showing_gender: '{gender}の商品を表示中。検索・音声・画像アップロードをご利用ください。',
    status_browse_start: '自然言語検索、音声検索、画像アップロードから開始できます。',
    status_searching: 'AIが類似アイテムを検索中...',
    status_no_query: '検索クエリを入力してください。',
    status_added_cart: 'カートに追加しました。',
    status_prepare_suggest: 'Suggestの準備中...',
    status_loading_personalized: 'おすすめを読み込み中...',
    status_run_search: '自然言語検索を実行中...',
    status_image_running: '画像一致検索を実行中...',
    status_image_optimized: '画像を最適化しました。画像一致検索を実行中...',
    status_generate_suggest: 'コーデ提案を生成中...',
    status_suggest_ready: 'Suggest結果を表示しました。',
    status_use_actions: '各アイテムで Explain / Suggest / Buy を利用できます。',
    empty_cart: 'カートは空です。',
  },
  zh: {
    brand_eyebrow: '环球时尚',
    brand_title: '穿搭助手',
    nav_home: '首页',
    nav_women: '女装',
    nav_men: '男装',
    nav_personalized: '个性化推荐',
    search_placeholder_home: '自然语言搜索，例如：我需要婚礼场景的现代海军蓝穿搭',
    search_placeholder_personalized: '输入新的需求并刷新推荐',
    find_items: '查找',
    voice_title: '语音输入',
    image_upload_match: '图片匹配',
    profile: '个人资料',
    cart: '购物车',
    close: '关闭',
    cancel: '取消',
    hero_title_home: '为下一次购买提供 AI 购物引导',
    hero_desc_home: '可使用自然语言搜索或上传图片。GlobalMart Fashion 的 Cohere AI 会从私有商品数据中推荐更匹配的款式。',
    suggested_for_you: '为你推荐',
    refresh_feed: '刷新',
    upload_title: '图片匹配',
    upload_desc: '上传 JPG/PNG 图片，AI 将推荐 10 个相似商品。',
    choose_image: '选择图片',
    upload_and_match: '上传并匹配',
    your_cart: '购物车',
    info: '信息',
    company: '公司',
    assistance: '帮助',
    legal: '法律',
    follow_us: '关注我们',
    about: '关于 GlobalMart Fashion',
    careers: '招聘',
    stores: '门店',
    customer_service: '客服',
    delivery: '配送',
    returns: '退货',
    terms: '条款与条件',
    privacy: '隐私说明',
    cookies: 'Cookie 设置',
    instagram: 'Instagram',
    youtube: 'YouTube',
    linkedin: 'LinkedIn',
    personalized_hero_title: '个性化推荐',
    personalized_hero_note: '先搜索或上传图片，即可生成个性化推荐。',
    recommended_items: '推荐商品',
    card_actions_hint: '卡片操作：Explain / Suggest / Buy',
    complete_look_title: '完善穿搭',
    complete_look_note: '点击推荐商品上的 Suggest，生成搭配补充商品。',
    explain: 'Explain',
    suggest: 'Suggest',
    buy: 'Buy',
    quantity: '数量',
    remove: '移除',
    status_loading_catalog: '正在加载{label}...',
    status_showing_gender: '当前展示 {gender} 商品，可使用搜索/语音/图片上传。',
    status_browse_start: '可从自然语言搜索、语音搜索或图片上传开始。',
    status_searching: 'AI 正在搜索相似商品...',
    status_no_query: '请先输入搜索内容。',
    status_added_cart: '已加入购物车。',
    status_prepare_suggest: '正在准备 Suggest 推荐...',
    status_loading_personalized: '正在加载个性化推荐...',
    status_run_search: '正在执行自然语言检索...',
    status_image_running: '正在执行图片匹配...',
    status_image_optimized: '图片已优化，正在执行图片匹配...',
    status_generate_suggest: '正在生成搭配建议...',
    status_suggest_ready: 'Suggest 结果已生成。',
    status_use_actions: '每个商品支持 Explain / Suggest / Buy。',
    empty_cart: '购物车为空。',
  },
  es: {
    brand_eyebrow: 'GlobalMart Fashion',
    brand_title: 'Asistente de Outfit',
    nav_home: 'Inicio',
    nav_women: 'Mujer',
    nav_men: 'Hombre',
    nav_personalized: 'Tu selección personalizada',
    search_placeholder_home: 'Busca en lenguaje natural, por ejemplo: quiero un look azul marino moderno para una boda',
    search_placeholder_personalized: 'Pide otro look y actualiza recomendaciones',
    find_items: 'Buscar',
    voice_title: 'Voz a texto',
    image_upload_match: 'Coincidencia por imagen',
    profile: 'Perfil',
    cart: 'Carrito',
    close: 'Cerrar',
    cancel: 'Cancelar',
    hero_title_home: 'Compras guiadas por IA para tu próxima compra',
    hero_desc_home:
      'Usa búsqueda en lenguaje natural o sube una imagen. La IA de GlobalMart Fashion con Cohere encuentra estilos similares desde datos privados.',
    suggested_for_you: 'Sugerido para ti',
    refresh_feed: 'Actualizar',
    upload_title: 'Coincidencia por imagen',
    upload_desc: 'Sube una imagen JPG/PNG y la IA recomendará 10 artículos similares.',
    choose_image: 'Elegir imagen',
    upload_and_match: 'Subir y comparar',
    your_cart: 'Tu carrito',
    info: 'Información',
    company: 'Compañía',
    assistance: 'Asistencia',
    legal: 'Legal',
    follow_us: 'Síguenos',
    about: 'Sobre GlobalMart Fashion',
    careers: 'Carreras',
    stores: 'Tiendas',
    customer_service: 'Atención al cliente',
    delivery: 'Envío',
    returns: 'Devoluciones',
    terms: 'Términos y condiciones',
    privacy: 'Aviso de privacidad',
    cookies: 'Configuración de cookies',
    instagram: 'Instagram',
    youtube: 'YouTube',
    linkedin: 'LinkedIn',
    personalized_hero_title: 'Tu selección personalizada',
    personalized_hero_note: 'Haz una búsqueda o sube una imagen para generar recomendaciones personalizadas.',
    recommended_items: 'Artículos recomendados',
    card_actions_hint: 'Acciones: Explain, Suggest, Buy.',
    complete_look_title: 'Completa el look',
    complete_look_note: 'Selecciona una recomendación y pulsa Suggest para generar artículos compatibles.',
    explain: 'Explain',
    suggest: 'Suggest',
    buy: 'Buy',
    quantity: 'Cant.',
    remove: 'Quitar',
    status_loading_catalog: 'Cargando {label}...',
    status_showing_gender: 'Mostrando productos de {gender}. Usa búsqueda, voz, imagen o carrito.',
    status_browse_start: 'Empieza con una consulta natural, voz o carga de imagen.',
    status_searching: 'La IA está buscando artículos similares...',
    status_no_query: 'Ingresa una consulta primero.',
    status_added_cart: 'Añadido al carrito.',
    status_prepare_suggest: 'Preparando recomendaciones Suggest...',
    status_loading_personalized: 'Cargando tus recomendaciones personalizadas...',
    status_run_search: 'Ejecutando búsqueda en lenguaje natural...',
    status_image_running: 'Ejecutando coincidencia por imagen...',
    status_image_optimized: 'Imagen optimizada. Ejecutando coincidencia por imagen...',
    status_generate_suggest: 'Generando recomendaciones para completar el look...',
    status_suggest_ready: 'Resultados Suggest listos.',
    status_use_actions: 'Usa Explain, Suggest o Buy en cada artículo.',
    empty_cart: 'Tu carrito está vacío.',
  },
};

function mapAlias(raw) {
  if (!raw) {
    return '';
  }
  return LANGUAGE_ALIASES[String(raw).trim().toLowerCase()] || '';
}

export function normalizeLanguage(raw) {
  const code = mapAlias(raw);
  return code || 'en';
}

export function initialLanguage(params = new URLSearchParams(window.location.search)) {
  const fromUrl = normalizeLanguage(params.get('lang'));
  if (fromUrl && SUPPORTED_LANGUAGES[fromUrl]) {
    return fromUrl;
  }
  const stored = normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY) || '');
  if (stored && SUPPORTED_LANGUAGES[stored]) {
    return stored;
  }
  const browser = normalizeLanguage(navigator.language || 'en');
  if (browser && SUPPORTED_LANGUAGES[browser]) {
    return browser;
  }
  return 'en';
}

export function persistLanguage(language) {
  const normalized = normalizeLanguage(language);
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
}

export function languageOptions() {
  return Object.values(SUPPORTED_LANGUAGES);
}

export function t(language, key, values = {}) {
  const normalized = normalizeLanguage(language);
  const template =
    STRINGS[normalized]?.[key] ??
    STRINGS.en?.[key] ??
    key;
  return Object.entries(values).reduce((out, [k, v]) => out.replaceAll(`{${k}}`, String(v)), template);
}

export function withLangPath(path, language) {
  const normalized = normalizeLanguage(language);
  const url = new URL(path, window.location.origin);
  url.searchParams.set('lang', normalized);
  return `${url.pathname}${url.search}`;
}

export function withLangHref(href, language) {
  const normalized = normalizeLanguage(language);
  const url = new URL(href, window.location.origin);
  url.searchParams.set('lang', normalized);
  return `${url.pathname}${url.search}`;
}

