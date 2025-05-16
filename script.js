console.log('script.js loaded, version: 2025-05-02');

const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

const tg = window.Telegram.WebApp;
tg.ready();

const registrationModal = document.getElementById('registration-modal');
const appContainer = document.getElementById('app-container');
const regFullname = document.getElementById('reg-fullname');
const submitProfileRegBtn = document.getElementById('submit-profile-reg-btn');
let userData = {};
let postsCache = [];
let lastPostId = null;
let currentTournamentId = null;
let isPostsLoaded = false;
let isLoadingMore = false;
let newPostsCount = 0;
let channel = null;
let commentChannels = new Map();
let reactionChannels = new Map();
let commentsCache = new Map();
let lastCommentIds = new Map();
let newCommentsCount = new Map();

const ratingData = [
  { name: "Олжас Сейтов", points: 948, rank: 1, club: "Дербес" },
  { name: "Мұхаммедәлі Әлішбаев", points: 936, rank: 2, club: "TЭО" },
  { name: "Нұрболат Тілеубай", points: 872, rank: 3, club: "КБТУ" },
  { name: "Темірлан Есенов", points: 785, rank: 4, club: "TЭО" },
  { name: "Нұрхан Жакен", points: 733, rank: 5, club: "Алтын Сапа" },
  { name: "Динара Әукенова", points: 671.5, rank: 6, club: "TЭО" },
  { name: "Ерасыл Шаймурадов", points: 665, rank: 7, club: "SDU" },
  { name: "Алтынай Қалдыбай", points: 600.5, rank: 8, club: "Дербес" },
  { name: "Жандос Әмре", points: 558, rank: 9, club: "UIB" },
  { name: "Ердаулет Қалмұрат", points: 462, rank: 10, club: "SDU" },
  { name: "Арайлым Абдукаримова", points: 460, rank: 11, club: "TЭО" },
  { name: "Ақылжан Итегулов", points: 440.5, rank: 12, club: "Дербес" },
  { name: "Ерғалым Айтжанов", points: 430.5, rank: 13, club: "ТЭО" },
  { name: "Еламан Әбдіманапов", points: 421, rank: 14, club: "Зиялы Қазақ" },
  { name: "Жансерік Жолшыбек", points: 411, rank: 15, club: "Сириус" },
  { name: "Регина Жардемгалиева", points: 400, rank: 16, club: "ТЭО" },
  { name: "Айдана Мухамет", points: 396, rank: 17, club: "НЛО" },
  { name: "Азамат Арынов", points: 377, rank: 18, club: "SDU" },
  { name: "Адема Сералиева", points: 373.5, rank: 19, club: "ТЭО" },
  { name: "Әлібек Сұлтанов", points: 351, rank: 20, club: "Алтын Сапа" },
  { name: "Гаухар Төлебай", points: 345, rank: 21, club: "SDU" },
  { name: "Әсет Оразғали", points: 336, rank: 22, club: "SDU" },
  { name: "Ислам Аманқос", points: 326.5, rank: 23, club: "SDU" },
  { name: "Арсен Сәуірбай", points: 322.5, rank: 24, club: "SDU" },
  { name: "Дәулет Мырзакулов", points: 282, rank: 25, club: "Алтын Сапа" },
  { name: "Димаш Әшірбек", points: 274, rank: 26, club: "SDU" },
  { name: "Ерлан Бөлекбаев", points: 268, rank: 27, club: "ТЭО" },
  { name: "Ахансері Амиреев", points: 263, rank: 28, club: "Сириус" },
  { name: "Айша Қуандық", points: 255.5, rank: 29, club: "SDU" },
  { name: "Диас Мухамет", points: 254, rank: 30, club: "Технократ" }
];

async function supabaseFetch(endpoint, method, body = null, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
        method,
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': method === 'POST' || method === 'PATCH' ? 'return=representation' : undefined
        },
        body: body ? JSON.stringify(body) : null
      });
      if (!response.ok) throw new Error(`Supabase error: ${response.status}`);
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } catch (error) {
      if (attempt === retries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

async function uploadImage(file) {
  const fileExt = file.name.split('.').pop();
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
  const { data, error } = await supabaseClient.storage.from('post-images').upload(fileName, file);
  if (error) throw new Error(`Image upload error: ${error.message}`);
  const { data: urlData } = supabaseClient.storage.from('post-images').getPublicUrl(fileName);
  return urlData.publicUrl;
}

async function saveChatId(userId) {
  if (tg.initDataUnsafe.user?.id) {
    try {
      const { error } = await supabaseClient.from('profiles').update({ chat_id: tg.initDataUnsafe.user.id.toString() }).eq('telegram_username', userData.telegramUsername);
      if (error) throw error;
      showProfile();
    } catch (error) {
      alert('Ошибка привязки Telegram: ' + error.message);
    }
  } else {
    tg.openTelegramLink(`https://t.me/MyPKRBot?start=${userId}`);
  }
}

async function showProfile() {
  const profileSection = document.getElementById('profile');
  try {
    const profiles = await supabaseFetch(`profiles?telegram_username=eq.${userData.telegramUsername}`, 'GET');
    if (profiles?.length > 0) {
      const profile = profiles[0];
      const chatIdStatus = profile.chat_id ? `Привязан (ID: ${profile.chat_id})` : 'Не привязан';
      profileSection.innerHTML = `
        <h2>Профиль</h2>
        ${!profile.chat_id ? '<p style="color: #ff4d4d;">📢 Привяжите Telegram!</p>' : ''}
        <p>Username: <span>${userData.telegramUsername}</span></p>
        <p>Chat ID: <span>${chatIdStatus}</span></p>
        <input id="fullname" type="text" value="${profile.fullname || ''}">
        <button id="update-profile">Изменить имя</button>
        ${!profile.chat_id ? '<button id="link-telegram">Привязать Telegram</button>' : ''}
      `;
      document.getElementById('update-profile').addEventListener('click', async () => {
        const newFullname = document.getElementById('fullname').value.trim();
        if (!newFullname) return alert('Введите новое имя!');
        userData.fullname = newFullname;
        try {
          await supabaseFetch(`profiles?telegram_username=eq.${userData.telegramUsername}`, 'PATCH', { fullname: newFullname });
          alert('Имя обновлено!');
        } catch (error) {
          alert('Ошибка: ' + error.message);
        }
      });
      if (!profile.chat_id) {
        document.getElementById('link-telegram').addEventListener('click', () => saveChatId(profiles[0].id));
      }
    }
  } catch (error) {
    profileSection.innerHTML += '<p>Ошибка загрузки профиля</p>';
  }
}

async function checkProfile() {
  const telegramUsername = tg.initDataUnsafe.user?.username;
  if (!telegramUsername) return alert('Укажите username в Telegram!');
  userData.telegramUsername = telegramUsername;
  try {
    const profiles = await supabaseFetch(`profiles?telegram_username=eq.${telegramUsername}`, 'GET');
    if (profiles?.length > 0) {
      userData.fullname = profiles[0].fullname;
      showApp();
      await saveChatId(profiles[0].id);
    } else {
      registrationModal.style.display = 'block';
    }
  } catch (error) {
    registrationModal.style.display = 'block';
  }
}

submitProfileRegBtn.addEventListener('click', async () => {
  if (!regFullname.value.trim()) return alert('Введите имя!');
  userData.fullname = regFullname.value.trim();
  try {
    await supabaseFetch('profiles', 'POST', {
      telegram_username: userData.telegramUsername,
      fullname: userData.fullname,
      chat_id: tg.initDataUnsafe.user?.id?.toString() || null
    });
    registrationModal.style.display = 'none';
    showApp();
  } catch (error) {
    alert('Ошибка: ' + error.message);
  }
});

function showApp() {
  appContainer.style.display = 'block';
  document.getElementById('username').textContent = userData.telegramUsername;
  document.getElementById('fullname').value = userData.fullname;
  loadPosts();
  subscribeToNewPosts();
  initRating();
}

const sections = document.querySelectorAll('.content');
const buttons = document.querySelectorAll('.nav-btn');

function debounce(func, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

buttons.forEach(button => {
  button.addEventListener('click', () => {
    buttons.forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    sections.forEach(section => section.classList.remove('active'));
    const targetSection = document.getElementById(button.id.replace('-btn', ''));
    targetSection.classList.add('active');
    if (button.id === 'feed-btn') debouncedLoadPosts();
    if (button.id === 'tournaments-btn') loadTournaments();
    if (button.id === 'rating-btn') initRating();
    if (button.id === 'profile-btn') showProfile();
  });
});

const debouncedLoadPosts = debounce(loadPosts, 300);

const postText = document.getElementById('post-text');
const postImage = document.getElementById('post-image');
const submitPost = document.getElementById('submit-post');
const postsDiv = document.getElementById('posts');
const newPostsBtn = document.createElement('button');
newPostsBtn.id = 'new-posts-btn';
newPostsBtn.className = 'new-posts-btn';
newPostsBtn.style.display = 'none';
newPostsBtn.innerHTML = 'Новые посты';
newPostsBtn.addEventListener('click', () => {
  loadNewPosts();
  newPostsBtn.style.display = 'none';
  newPostsCount = 0;
});
document.getElementById('feed').prepend(newPostsBtn);

const loadMoreBtn = document.createElement('button');
loadMoreBtn.id = 'load-more-btn';
loadMoreBtn.className = 'load-more-btn';
loadMoreBtn.innerHTML = 'Загрузить ещё';
loadMoreBtn.style.display = 'block';
loadMoreBtn.addEventListener('click', loadMorePosts);
postsDiv.appendChild(loadMoreBtn);

async function processTags(text, postId) {
  const tagRegex = /@([a-zA-Z0-9_]+)/g;
  const tags = text.match(tagRegex) || [];
  for (const tag of tags) {
    const username = tag.slice(1);
    await supabaseFetch('tag_notifications', 'POST', {
      tagged_username: username,
      post_id: postId,
      user_id: userData.telegramUsername,
      text: text,
      timestamp: new Date().toISOString()
    });
  }
}

submitPost.addEventListener('click', async () => {
  if (submitPost.disabled) return;
  submitPost.disabled = true;
  const postContent = postText.value.trim();
  if (!postContent) {
    alert('Введите текст поста!');
    submitPost.disabled = false;
    return;
  }
  const text = `${userData.fullname} (@${userData.telegramUsername}):\n${postContent}`;
  const post = {
    text,
    timestamp: new Date().toISOString(),
    user_id: userData.telegramUsername
  };
  try {
    if (postImage.files.length > 0) post.image_url = await uploadImage(postImage.files[0]);
    const newPost = await supabaseFetch('posts', 'POST', post);
    postText.value = '';
    postImage.value = '';
    if (!postsCache.some(p => p.id === newPost[0].id)) {
      postsCache.unshift(newPost[0]);
      sortPostsCache();
      if (isUserAtTop()) renderNewPost(newPost[0], true);
      else {
        newPostsCount++;
        newPostsBtn.style.display = 'block';
      }
      lastPostId = postsCache[0].id;
      await processTags(postContent, newPost[0].id);
    }
  } catch (error) {
    alert('Ошибка: ' + error.message);
  } finally {
    submitPost.disabled = false;
  }
});

async function loadPosts() {
  if (isPostsLoaded) {
    renderPosts();
    return;
  }
  const loadingIndicator = document.getElementById('posts-loading');
  loadingIndicator.style.display = 'block';
  try {
    postsCache = [];
    const posts = await supabaseFetch('posts?order=id.desc&limit=20', 'GET');
    if (posts) {
      postsCache = posts;
      sortPostsCache();
      renderPosts();
      if (postsCache.length > 0) lastPostId = postsCache[0].id;
      isPostsLoaded = true;
      const totalPosts = await supabaseFetch('posts?select=id', 'GET');
      loadMoreBtn.style.display = totalPosts?.length > 20 ? 'block' : 'none';
      if (posts.length === 20) loadMorePosts();
    }
  } catch (error) {
    alert('Ошибка загрузки постов: ' + error.message);
  } finally {
    loadingIndicator.style.display = 'none';
  }
  setupInfiniteScroll();
}

async function loadMorePosts() {
  if (isLoadingMore || postsCache.length === 0) return;
  isLoadingMore = true;
  const oldestPostId = postsCache[postsCache.length - 1].id;
  try {
    const morePosts = await supabaseFetch(`posts?id=lt.${oldestPostId}&order=id.desc&limit=20`, 'GET');
    if (morePosts?.length > 0) {
      const newPosts = morePosts.filter(post => !postsCache.some(p => p.id === post.id));
      if (newPosts.length > 0) {
        postsCache.push(...newPosts);
        sortPostsCache();
        renderMorePosts(newPosts);
        loadMoreBtn.style.display = 'block';
      } else loadMoreBtn.style.display = 'none';
    } else loadMoreBtn.style.display = 'none';
  } catch (error) {
    console.error('Error in loadMorePosts:', error);
  } finally {
    isLoadingMore = false;
  }
}

async function loadNewPosts() {
  try {
    const newPosts = await supabaseFetch(`posts?id=gt.${lastPostId}&order=id.desc`, 'GET');
    if (newPosts?.length > 0) {
      const uniqueNewPosts = newPosts.filter(post => !postsCache.some(p => p.id === post.id));
      if (uniqueNewPosts.length > 0) {
        postsCache.unshift(...uniqueNewPosts);
        sortPostsCache();
        renderNewPosts(uniqueNewPosts, true);
        lastPostId = postsCache[0].id;
      }
    }
  } catch (error) {
    console.error('Error loading new posts:', error);
  }
}

function subscribeToNewPosts() {
  if (channel) supabaseClient.removeChannel(channel);
  channel = supabaseClient
    .channel('posts-channel')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, payload => {
      const newPost = payload.new;
      if (!postsCache.some(post => post.id === newPost.id)) {
        postsCache.unshift(newPost);
        sortPostsCache();
        if (isUserAtTop()) {
          renderNewPost(newPost, true);
          lastPostId = postsCache[0].id;
        } else {
          newPostsCount++;
          newPostsBtn.style.display = 'block';
        }
      }
    })
    .subscribe();
}

function isUserAtTop() {
  return document.getElementById('feed').scrollTop <= 50;
}

function setupInfiniteScroll() {
  const feedSection = document.getElementById('feed');
  feedSection.style.overflowY = 'auto';
  feedSection.removeEventListener('scroll', debouncedLoadMorePosts);
  feedSection.addEventListener('scroll', debouncedLoadMorePosts);
}

const debouncedLoadMorePosts = debounce(() => {
  const feedSection = document.getElementById('feed');
  const scrollBottom = feedSection.scrollHeight - feedSection.scrollTop - feedSection.clientHeight;
  if (scrollBottom <= 200) loadMorePosts();
}, 300);

function sortPostsCache() {
  postsCache.sort((a, b) => b.id - a.id);
}

function renderPosts() {
  postsDiv.innerHTML = '';
  for (const post of postsCache) renderNewPost(post, false);
  postsDiv.appendChild(loadMoreBtn);
}

function renderNewPosts(newPosts, prepend = false) {
  for (const post of newPosts) renderNewPost(post, prepend);
}

function formatPostContent(content) {
  let formatted = content.replace(/\n/g, '<br>');
  const urlRegex = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]\}])/g;
  formatted = formatted.replace(urlRegex, url => `<a href="${url}" target="_blank">${url}</a>`);
  const tagRegex = /@([a-zA-Z0-9_]+)/g;
  formatted = formatted.replace(tagRegex, tag => `<span class="tag">${tag}</span>`);
  return formatted;
}

function renderNewPost(post, prepend = false) {
  const postDiv = document.createElement('div');
  postDiv.classList.add('post');
  postDiv.setAttribute('data-post-id', post.id);
  const [userInfo, ...contentParts] = post.text.split(':\n');
  const [fullname, username] = userInfo.split(' (@');
  const cleanUsername = username ? username.replace(')', '') : '';
  const content = contentParts.join(':\n');
  const formattedContent = formatPostContent(content);
  const timeAgo = getTimeAgo(new Date(post.timestamp));
  postDiv.innerHTML = `
    <div class="post-header">
      <div class="post-user"><strong>${fullname}</strong><span>@${cleanUsername}</span></div>
      <div class="post-time">${timeAgo}</div>
    </div>
    <div class="post-content">${formattedContent}</div>
    ${post.image_url ? `<img src="${post.image_url}" class="post-image">` : ''}
    <div class="post-actions">
      <button class="reaction-btn like-btn" onclick="toggleReaction(${post.id}, 'like')">👍 0</button>
      <button class="reaction-btn dislike-btn" onclick="toggleReaction(${post.id}, 'dislike')">👎 0</button>
      <button class="comment-toggle-btn" onclick="toggleComments(${post.id})">💬 Комментарии (0)</button>
    </div>
    <div class="comment-section" id="comments-${post.id}" style="display: none;">
      <button id="new-comments-btn-${post.id}" class="new-posts-btn" style="display: none;">Новые комментарии</button>
      <div class="comment-list" id="comment-list-${post.id}" style="max-height: 200px; overflow-y: auto;"></div>
      <div class="comment-form">
        <textarea class="comment-input" id="comment-input-${post.id}" placeholder="Написать комментарий..."></textarea>
        <button onclick="addComment(${post.id})">Отправить</button>
      </div>
    </div>
  `;
  if (prepend) postsDiv.prepend(postDiv);
  else postsDiv.appendChild(postDiv);
  loadReactionsAndComments(post.id);
  subscribeToReactions(post.id);
}

async function renderMorePosts(newPosts) {
  for (const post of newPosts) {
    const postDiv = document.createElement('div');
    postDiv.classList.add('post');
    postDiv.setAttribute('data-post-id', post.id);
    const [userInfo, ...contentParts] = post.text.split(':\n');
    const [fullname, username] = userInfo.split(' (@');
    const cleanUsername = username ? username.replace(')', '') : '';
    const content = contentParts.join(':\n');
    const formattedContent = formatPostContent(content);
    const timeAgo = getTimeAgo(new Date(post.timestamp));
    postDiv.innerHTML = `
      <div class="post-header">
        <div class="post-user"><strong>${fullname}</strong><span>@${cleanUsername}</span></div>
        <div class="post-time">${timeAgo}</div>
      </div>
      <div class="post-content">${formattedContent}</div>
      ${post.image_url ? `<img src="${post.image_url}" class="post-image">` : ''}
      <div class="post-actions">
        <button class="reaction-btn like-btn" onclick="toggleReaction(${post.id}, 'like')">👍 0</button>
        <button class="reaction-btn dislike-btn" onclick="toggleReaction(${post.id}, 'dislike')">👎 0</button>
        <button class="comment-toggle-btn" onclick="toggleComments(${post.id})">💬 Комментарии (0)</button>
      </div>
      <div class="comment-section" id="comments-${post.id}" style="display: none;">
        <button id="new-comments-btn-${post.id}" class="new-posts-btn" style="display: none;">Новые комментарии</button>
        <div class="comment-list" id="comment-list-${post.id}" style="max-height: 200px; overflow-y: auto;"></div>
        <div class="comment-form">
          <textarea class="comment-input" id="comment-input-${post.id}" placeholder="Написать комментарий..."></textarea>
          <button onclick="addComment(${post.id})">Отправить</button>
        </div>
      </div>
    `;
    postsDiv.appendChild(postDiv);
    loadReactionsAndComments(post.id);
    subscribeToReactions(post.id);
  }
  postsDiv.appendChild(loadMoreBtn);
}

async function loadReactionsAndComments(postId) {
  try {
    const reactions = await loadReactions(postId);
    const likes = reactions.filter(r => r.type === 'like').length;
    const dislikes = reactions.filter(r => r.type === 'dislike').length;
    const userReaction = reactions.find(r => r.user_id === userData.telegramUsername);
    const likeClass = userReaction?.type === 'like' ? 'active' : '';
    const dislikeClass = userReaction?.type === 'dislike' ? 'active' : '';
    const comments = await loadComments(postId);
    const commentCount = comments?.length || 0;
    const postDiv = postsDiv.querySelector(`[data-post-id="${postId}"]`);
    if (postDiv) {
      const likeBtn = postDiv.querySelector('.like-btn');
      const dislikeBtn = postDiv.querySelector('.dislike-btn');
      const commentBtn = postDiv.querySelector('.comment-toggle-btn');
      likeBtn.className = `reaction-btn like-btn ${likeClass}`;
      likeBtn.innerHTML = `👍 ${likes}`;
      dislikeBtn.className = `reaction-btn dislike-btn ${dislikeClass}`;
      dislikeBtn.innerHTML = `👎 ${dislikes}`;
      commentBtn.innerHTML = `💬 Комментарии (${commentCount})`;
      if (comments) await renderComments(postId, comments);
      setupCommentInfiniteScroll(postId);
    }
  } catch (error) {
    console.error('Error loading reactions/comments:', error);
  }
}

async function updatePost(postId) {
  const postIndex = postsCache.findIndex(post => post.id === postId);
  if (postIndex === -1) return;
  const post = await supabaseFetch(`posts?id=eq.${postId}`, 'GET');
  if (!post?.length) return;
  const reactions = await loadReactions(postId);
  const likes = reactions.filter(r => r.type === 'like').length;
  const dislikes = reactions.filter(r => r.type === 'dislike').length;
  const userReaction = reactions.find(r => r.user_id === userData.telegramUsername);
  const likeClass = userReaction?.type === 'like' ? 'active' : '';
  const dislikeClass = userReaction?.type === 'dislike' ? 'active' : '';
  const comments = await loadComments(postId);
  const commentCount = comments?.length || 0;
  postsCache[postIndex] = post[0];
  const postDiv = postsDiv.querySelector(`[data-post-id="${postId}"]`);
  if (!postDiv) return;
  const [userInfo, ...contentParts] = post[0].text.split(':\n');
  const [fullname, username] = userInfo.split(' (@');
  const cleanUsername = username ? username.replace(')', '') : '';
  const content = contentParts.join(':\n');
  const formattedContent = formatPostContent(content);
  const timeAgo = getTimeAgo(new Date(post[0].timestamp));
  postDiv.innerHTML = `
    <div class="post-header">
      <div class="post-user"><strong>${fullname}</strong><span>@${cleanUsername}</span></div>
      <div class="post-time">${timeAgo}</div>
    </div>
    <div class="post-content">${formattedContent}</div>
    ${post[0].image_url ? `<img src="${post[0].image_url}" class="post-image">` : ''}
    <div class="post-actions">
      <button class="reaction-btn like-btn ${likeClass}" onclick="toggleReaction(${postId}, 'like')">👍 ${likes}</button>
      <button class="reaction-btn dislike-btn ${dislikeClass}" onclick="toggleReaction(${postId}, 'dislike')">👎 ${dislikes}</button>
      <button class="comment-toggle-btn" onclick="toggleComments(${postId})">💬 Комментарии (${commentCount})</button>
    </div>
    <div class="comment-section" id="comments-${postId}" style="display: none;">
      <button id="new-comments-btn-${postId}" class="new-posts-btn" style="display: none;">Новые комментарии</button>
      <div class="comment-list" id="comment-list-${postId}" style="max-height: 200px; overflow-y: auto;"></div>
      <div class="comment-form">
        <textarea class="comment-input" id="comment-input-${postId}" placeholder="Написать комментарий..."></textarea>
        <button onclick="addComment(${postId})">Отправить</button>
      </div>
    </div>
  `;
  if (comments) await renderComments(postId, comments);
  setupCommentInfiniteScroll(postId);
}

function getTimeAgo(date) {
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);
  if (diffInSeconds < 60) return `${diffInSeconds}s`;
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h`;
  return `${Math.floor(diffInHours / 24)}d`;
}

async function loadReactions(postId) {
  try {
    const reactions = await supabaseFetch(`reactions?post_id=eq.${postId}`, 'GET');
    return reactions || [];
  } catch (error) {
    return [];
  }
}

function subscribeToReactions(postId) {
  if (reactionChannels.has(postId)) supabaseClient.removeChannel(reactionChannels.get(postId));
  const channel = supabaseClient
    .channel(`reactions-channel-${postId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions', filter: `post_id=eq.${postId}` }, () => updatePost(postId))
    .subscribe();
  reactionChannels.set(postId, channel);
}

async function toggleReaction(postId, type) {
  postId = parseInt(postId);
  try {
    const userExists = await supabaseFetch(`profiles?telegram_username=eq.${userData.telegramUsername}`, 'GET');
    if (!userExists?.length) throw new Error('Пользователь не найден!');
    const userReaction = await supabaseFetch(`reactions?post_id=eq.${postId}&user_id=eq.${userData.telegramUsername}`, 'GET');
    if (userReaction?.length > 0) {
      const currentReaction = userReaction[0];
      if (currentReaction.type === type) await supabaseFetch(`reactions?id=eq.${currentReaction.id}`, 'DELETE');
      else await supabaseFetch(`reactions?id=eq.${currentReaction.id}`, 'PATCH', { type });
    } else {
      await supabaseFetch('reactions', 'POST', {
        post_id: postId,
        user_id: userData.telegramUsername,
        type,
        timestamp: new Date().toISOString()
      });
    }
    await updatePost(postId);
  } catch (error) {
    alert('Ошибка: ' + error.message);
  }
}

async function loadComments(postId) {
  try {
    if (!commentsCache.has(postId)) {
      commentsCache.set(postId, []);
      lastCommentIds.set(postId, null);
      newCommentsCount.set(postId, 0);
    }
    const comments = await supabaseFetch(`comments?post_id=eq.${postId}&order=id.asc&limit=10`, 'GET');
    if (comments?.length > 0) {
      const currentComments = commentsCache.get(postId);
      const newComments = comments.filter(comment => !currentComments.some(c => c.id === comment.id));
      commentsCache.set(postId, [...newComments, ...currentComments]);
      sortCommentsCache(postId);
      if (newComments.length > 0) lastCommentIds.set(postId, commentsCache.get(postId)[commentsCache.get(postId).length - 1].id);
    }
    return commentsCache.get(postId);
  } catch (error) {
    return [];
  }
}

async function loadMoreComments(postId) {
  const commentList = document.getElementById(`comment-list-${postId}`);
  if (!commentList || commentList.dataset.isLoadingMore === 'true') return;
  commentList.dataset.isLoadingMore = 'true';
  const oldestCommentId = commentsCache.get(postId).length > 0 ? commentsCache.get(postId)[0].id : null;
  try {
    const moreComments = await supabaseFetch(`comments?post_id=eq.${postId}&id=lt.${oldestCommentId}&order=id.asc&limit=10`, 'GET');
    if (moreComments?.length > 0) {
      const currentComments = commentsCache.get(postId);
      const newComments = moreComments.filter(comment => !currentComments.some(c => c.id === comment.id));
      if (newComments.length > 0) {
        commentsCache.set(postId, [...newComments, ...currentComments]);
        sortCommentsCache(postId);
        renderMoreComments(postId, newComments);
      }
    }
  } catch (error) {
    console.error('Error loading more comments:', error);
  } finally {
    commentList.dataset.isLoadingMore = 'false';
  }
}

async function loadNewComments(postId) {
  const lastCommentId = lastCommentIds.get(postId);
  if (!lastCommentId) return;
  try {
    const newComments = await supabaseFetch(`comments?post_id=eq.${postId}&id=gt.${lastCommentId}&order=id.asc`, 'GET');
    if (newComments?.length > 0) {
      const currentComments = commentsCache.get(postId);
      const uniqueNewComments = newComments.filter(comment => !currentComments.some(c => c.id === comment.id));
      if (uniqueNewComments.length > 0) {
        commentsCache.set(postId, [...currentComments, ...uniqueNewComments]);
        sortCommentsCache(postId);
        renderNewComments(postId, uniqueNewComments, true);
        lastCommentIds.set(postId, commentsCache.get(postId)[commentsCache.get(postId).length - 1].id);
      }
    }
  } catch (error) {
    console.error('Error loading new comments:', error);
  }
}

function subscribeToNewComments(postId) {
  if (commentChannels.has(postId)) supabaseClient.removeChannel(commentChannels.get(postId));
  const channel = supabaseClient
    .channel(`comments-channel-${postId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` }, payload => {
      const newComment = payload.new;
      const currentComments = commentsCache.get(postId) || [];
      if (!currentComments.some(comment => comment.id === newComment.id)) {
        commentsCache.set(postId, [...currentComments, newComment]);
        sortCommentsCache(postId);
        if (isUserAtBottom(postId)) {
          renderNewComment(postId, newComment, true);
          lastCommentIds.set(postId, commentsCache.get(postId)[commentsCache.get(postId).length - 1].id);
        } else {
          const currentCount = newCommentsCount.get(postId) || 0;
          newCommentsCount.set(postId, currentCount + 1);
          const newCommentsBtn = document.getElementById(`new-comments-btn-${postId}`);
          if (newCommentsBtn) {
            newCommentsBtn.style.display = 'block';
            newCommentsBtn.textContent = `Новые комментарии (${newCommentsCount.get(postId)})`;
          }
        }
      }
    })
    .subscribe();
  commentChannels.set(postId, channel);
}

function isUserAtBottom(postId) {
  const commentList = document.getElementById(`comment-list-${postId}`);
  return commentList ? commentList.scrollHeight - commentList.scrollTop <= commentList.clientHeight + 50 : false;
}

function setupCommentInfiniteScroll(postId) {
  const commentList = document.getElementById(`comment-list-${postId}`);
  if (!commentList) return;
  if (commentChannels.has(postId)) {
    supabaseClient.removeChannel(commentChannels.get(postId));
    commentChannels.delete(postId);
  }
  const debouncedLoadMoreComments = debounce(() => {
    if (commentList.scrollTop <= 50) loadMoreComments(postId);
  }, 300);
  commentList.removeEventListener('scroll', debouncedLoadMoreComments);
  commentList.addEventListener('scroll', debouncedLoadMoreComments);
  subscribeToNewComments(postId);
  const newCommentsBtn = document.getElementById(`new-comments-btn-${postId}`);
  if (newCommentsBtn) {
    newCommentsBtn.onclick = () => {
      loadNewComments(postId);
      newCommentsBtn.style.display = 'none';
      newCommentsCount.set(postId, 0);
    };
  }
}

function sortCommentsCache(postId) {
  const comments = commentsCache.get(postId);
  if (comments) {
    comments.sort((a, b) => a.id - b.id);
    commentsCache.set(postId, comments);
  }
}

async function renderComments(postId, comments) {
  const commentList = document.getElementById(`comment-list-${postId}`);
  if (!commentList) return;
  commentList.innerHTML = '';
  comments.forEach(comment => renderNewComment(postId, comment, true));
}

async function renderNewComments(postId, newComments, append = true) {
  for (const comment of newComments) renderNewComment(postId, comment, append);
}

function renderNewComment(postId, comment, append = true) {
  const commentList = document.getElementById(`comment-list-${postId}`);
  if (!commentList) return;
  const commentDiv = document.createElement('div');
  commentDiv.classList.add('comment');
  const [userInfo, ...contentParts] = comment.text.split(':\n');
  const [fullname, username] = userInfo.split(' (@');
  const cleanUsername = username ? username.replace(')', '') : '';
  const content = contentParts.join(':\n');
  const formattedContent = formatPostContent(content);
  commentDiv.innerHTML = `
    <div class="comment-user"><strong>${fullname}</strong><span>@${cleanUsername}</span></div>
    <div class="comment-content">${formattedContent}</div>
  `;
  if (append) {
    commentList.appendChild(commentDiv);
    if (isUserAtBottom(postId)) commentList.scrollTop = commentList.scrollHeight;
  } else commentList.prepend(commentDiv);
}

async function renderMoreComments(postId, newComments) {
  const commentList = document.getElementById(`comment-list-${postId}`);
  if (!commentList) return;
  for (const comment of newComments) {
    const commentDiv = document.createElement('div');
    commentDiv.classList.add('comment');
    const [userInfo, ...contentParts] = comment.text.split(':\n');
    const [fullname, username] = userInfo.split(' (@');
    const cleanUsername = username ? username.replace(')', '') : '';
    const content = contentParts.join(':\n');
    const formattedContent = formatPostContent(content);
    commentDiv.innerHTML = `
      <div class="comment-user"><strong>${fullname}</strong><span>@${cleanUsername}</span></div>
      <div class="comment-content">${formattedContent}</div>
    `;
    commentList.appendChild(commentDiv);
  }
}

async function addComment(postId) {
  postId = parseInt(postId);
  const commentInput = document.getElementById(`comment-input-${postId}`);
  const commentButton = commentInput.parentElement.querySelector('button');
  if (!commentInput || !commentButton || commentButton.disabled) return;
  commentButton.disabled = true;
  const text = commentInput.value.trim();
  if (!text) {
    alert('Введите текст комментария!');
    commentButton.disabled = false;
    return;
  }
  try {
    const postExists = await supabaseFetch(`posts?id=eq.${postId}`, 'GET');
    if (!postExists?.length) throw new Error('Пост не найден!');
    const userExists = await supabaseFetch(`profiles?telegram_username=eq.${userData.telegramUsername}`, 'GET');
    if (!userExists?.length) throw new Error('Пользователь не найден!');
    const comment = {
      post_id: postId,
      user_id: userData.telegramUsername,
      text: `${userData.fullname} (@${userData.telegramUsername}):\n${text}`,
      timestamp: new Date().toISOString()
    };
    const newComment = await supabaseFetch('comments', 'POST', comment);
    commentInput.value = '';
    const currentComments = commentsCache.get(postId) || [];
    if (!currentComments.some(c => c.id === newComment[0].id)) {
      commentsCache.set(postId, [...currentComments, newComment[0]]);
      sortCommentsCache(postId);
      if (isUserAtBottom(postId)) {
        renderNewComment(postId, newComment[0], true);
        lastCommentIds.set(postId, commentsCache.get(postId)[commentsCache.get(postId).length - 1].id);
      } else {
        const currentCount = newCommentsCount.get(postId) || 0;
        newCommentsCount.set(postId, currentCount + 1);
        const newCommentsBtn = document.getElementById(`new-comments-btn-${postId}`);
        if (newCommentsBtn) {
          newCommentsBtn.style.display = 'block';
          newCommentsBtn.textContent = `Новые комментарии (${newCommentsCount.get(postId)})`;
        }
      }
      await processTags(text, null);
    }
    await updatePost(postId);
  } catch (error) {
    alert('Ошибка: ' + error.message);
  } finally {
    commentButton.disabled = false;
  }
}

function toggleComments(postId) {
  const commentSection = document.getElementById(`comments-${postId}`);
  if (commentSection) {
    const isVisible = commentSection.style.display === 'block';
    commentSection.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) {
      loadComments(postId).then(comments => renderComments(postId, comments));
      setupCommentInfiniteScroll(postId);
    } else if (commentChannels.has(postId)) {
      supabaseClient.removeChannel(commentChannels.get(postId));
      commentChannels.delete(postId);
    }
  }
}

const createTournamentBtn = document.getElementById('create-tournament-btn');
const createTournamentForm = document.getElementById('create-tournament-form');
const submitTournament = document.getElementById('submit-tournament');
const tournamentList = document.getElementById('tournament-list');

createTournamentBtn.addEventListener('click', () => {
  createTournamentForm.classList.toggle('form-hidden');
});

submitTournament.addEventListener('click', async () => {
  const tournament = {
    name: document.getElementById('tournament-name').value,
    date: document.getElementById('tournament-date').value,
    logo: document.getElementById('tournament-logo').value,
    desc: document.getElementById('tournament-desc').value,
    address: document.getElementById('tournament-address').value,
    deadline: document.getElementById('tournament-deadline').value,
    creator_id: userData.telegramUsername,
    timestamp: new Date().toISOString()
  };
  try {
    await supabaseFetch('tournaments', 'POST', tournament);
    alert('Турнир создан!');
    createTournamentForm.classList.add('form-hidden');
    document.getElementById('tournament-name').value = '';
    document.getElementById('tournament-date').value = '';
    document.getElementById('tournament-logo').value = '';
    document.getElementById('tournament-desc').value = '';
    document.getElementById('tournament-address').value = '';
    document.getElementById('tournament-deadline').value = '';
    loadTournaments();
  } catch (error) {
    alert('Ошибка: ' + error.message);
  }
});

async function loadTournaments() {
  try {
    const tournaments = await supabaseFetch('tournaments?order=timestamp.desc&limit=50', 'GET');
    tournamentList.innerHTML = '';
    if (tournaments) {
      tournaments.forEach(tournament => {
        const tournamentCard = document.createElement('div');
        tournamentCard.classList.add('tournament-card');
        tournamentCard.setAttribute('data-tournament-id', tournament.id);
        tournamentCard.addEventListener('click', () => showTournamentDetails(tournament.id));
        const logoUrl = tournament.logo || 'placeholder.png';
        const city = tournament.address ? extractCityFromAddress(tournament.address) : 'Не указан';
        tournamentCard.innerHTML = `
          <img src="${logoUrl}" class="tournament-logo" alt="Логотип турнира" onerror="this.src='placeholder.png'">
          <div class="tournament-info">
            <strong>${tournament.name}</strong>
            <span>Дата: ${tournament.date}</span>
            <span>Город: ${city}</span>
          </div>
        `;
        tournamentList.appendChild(tournamentCard);
      });
    }
  } catch (error) {
    alert('Ошибка загрузки турниров: ' + error.message);
  }
}

async function showTournamentDetails(tournamentId) {
  try {
    const tournament = await supabaseFetch(`tournaments?id=eq.${tournamentId}`, 'GET');
    if (!tournament?.length) return;
    currentTournamentId = tournamentId;
    const data = tournament[0];
    const city = data.address ? extractCityFromAddress(data.address) : 'Не указан';
    const isCreator = data.creator_id === userData.telegramUsername;
    const header = document.getElementById('tournament-header');
    const description = document.getElementById('tournament-description');
    const toggleBtn = document.getElementById('toggle-description-btn');
    header.innerHTML = `
      <img src="${data.logo || 'placeholder.png'}" alt="Логотип турнира" onerror="this.src='placeholder.png'">
      <strong>${data.name}</strong>
      <p>Дата: ${data.date}</p>
      <p>Город: ${city}</p>
      <p>Адрес: <a href="${data.address}" target="_blank">${data.address}</a></p>
      <p>Дедлайн: ${data.deadline}</p>
    `;
    description.innerHTML = `<p>Описание: ${data.desc || 'Описание отсутствует'}</p>`;
    sections.forEach(section => section.classList.remove('active'));
    document.getElementById('tournament-details').classList.add('active');
    buttons.forEach(btn => btn.classList.remove('active'));
    toggleBtn.onclick = () => {
      if (description.classList.contains('description-hidden')) {
        description.classList.remove('description-hidden');
        toggleBtn.textContent = 'Свернуть описание';
      } else {
        description.classList.add('description-hidden');
        toggleBtn.textContent = 'Развернуть описание';
      }
    };
    initTabs();
    initTournamentPosts(isCreator, data.name);
    loadTournamentPosts(tournamentId);
    initRegistration();
    loadRegistrations(tournamentId, isCreator);
    initBracket(isCreator);
    loadBracket(tournamentId);
  } catch (error) {
    alert('Ошибка: ' + error.message);
  }
}

function extractCityFromAddress(address) {
  return address.split('/')[3] || 'Не указан';
}

function initTabs() {
  const postsTab = document.getElementById('posts-tab');
  const registrationTab = document.getElementById('registration-tab');
  const bracketTab = document.getElementById('bracket-tab');
  const postsContent = document.getElementById('tournament-posts');
  const registrationContent = document.getElementById('tournament-registration');
  const bracketContent = document.getElementById('tournament-bracket');
  postsTab.onclick = () => {
    postsTab.classList.add('active');
    registrationTab.classList.remove('active');
    bracketTab.classList.remove('active');
    postsContent.classList.add('active');
    registrationContent.classList.remove('active');
    bracketContent.classList.remove('active');
  };
  registrationTab.onclick = () => {
    registrationTab.classList.add('active');
    postsTab.classList.remove('active');
    bracketTab.classList.remove('active');
    registrationContent.classList.add('active');
    postsContent.classList.remove('active');
    bracketContent.classList.remove('active');
  };
  bracketTab.onclick = () => {
    bracketTab.classList.add('active');
    postsTab.classList.remove('active');
    registrationTab.classList.remove('active');
    bracketContent.classList.add('active');
    postsContent.classList.remove('active');
    registrationContent.classList.remove('active');
  };
}

function initTournamentPosts(isCreator, tournamentName) {
  const postsSection = document.getElementById('tournament-posts');
  postsSection.innerHTML = '';
  if (isCreator) {
    postsSection.innerHTML = `
      <div id="new-tournament-post">
        <textarea id="tournament-post-text" placeholder="Создать пост от имени турнира"></textarea>
        <button id="submit-tournament-post">Опубликовать</button>
      </div>
      <div id="tournament-posts-list"></div>
    `;
    document.getElementById('submit-tournament-post').onclick = async () => {
      const submitButton = document.getElementById('submit-tournament-post');
      if (submitButton.disabled) return;
      submitButton.disabled = true;
      const text = document.getElementById('tournament-post-text').value.trim();
      if (!text) {
        alert('Введите текст поста!');
        submitButton.disabled = false;
        return;
      }
      try {
        await supabaseFetch('tournament_posts', 'POST', {
          tournament_id: currentTournamentId,
          creator_id: userData.telegramUsername,
          text,
          timestamp: new Date().toISOString()
        });
        document.getElementById('tournament-post-text').value = '';
        loadTournamentPosts(currentTournamentId);
      } catch (error) {
        alert('Ошибка: ' + error.message);
      } finally {
        submitButton.disabled = false;
      }
    };
  } else {
    postsSection.innerHTML = `<div id="tournament-posts-list"></div>`;
  }
}

async function loadTournamentPosts(tournamentId) {
  try {
    const posts = await supabaseFetch(`tournament_posts?tournament_id=eq.${tournamentId}&order=timestamp.desc`, 'GET');
    const postsList = document.getElementById('tournament-posts-list');
    postsList.innerHTML = '';
    if (posts?.length > 0) {
      const tournament = await supabaseFetch(`tournaments?id=eq.${tournamentId}`, 'GET');
      const tournamentName = tournament[0].name;
      posts.forEach(post => {
        const postDiv = document.createElement('div');
        postDiv.classList.add('post');
        postDiv.innerHTML = `
          <div class="post-header">
            <strong>Турнир: ${tournamentName}</strong>
            <span>${getTimeAgo(new Date(post.timestamp))}</span>
          </div>
          <div class="post-content">${post.text}</div>
        `;
        postsList.appendChild(postDiv);
      });
    } else {
      postsList.innerHTML = '<p>Пока нет постов от турнира.</p>';
    }
  } catch (error) {
    postsList.innerHTML = '<p>Ошибка загрузки постов.</p>';
  }
}

function initRegistration() {
  const registerBtn = document.getElementById('register-tournament-btn');
  const registrationForm = document.getElementById('registration-form');
  const submitRegistrationBtn = document.getElementById('submit-registration-btn');
  registerBtn.onclick = () => registrationForm.classList.toggle('form-hidden');
  submitRegistrationBtn.addEventListener('click', async () => {
    if (submitRegistrationBtn.disabled) return;
    submitRegistrationBtn.disabled = true;
    const registration = {
      tournament_id: currentTournamentId,
      faction_name: document.getElementById('reg-faction-name').value,
      speaker1: document.getElementById('reg-speaker1').value,
      speaker2: document.getElementById('reg-speaker2').value,
      club: document.getElementById('reg-club').value,
      city: document.getElementById('reg-city').value,
      contacts: document.getElementById('reg-contacts').value,
      extra: document.getElementById('reg-extra').value,
      timestamp: new Date().toISOString()
    };
    if (!registration.faction_name) {
      alert('Укажите название фракции!');
      submitRegistrationBtn.disabled = false;
      return;
    }
    if (!registration.club) {
      alert('Укажите название клуба!');
      submitRegistrationBtn.disabled = false;
      return;
    }
    try {
      await supabaseFetch('registrations', 'POST', registration);
      alert('Регистрация отправлена!');
      registrationForm.classList.add('form-hidden');
      document.getElementById('reg-faction-name').value = '';
      document.getElementById('reg-speaker1').value = '';
      document.getElementById('reg-speaker2').value = '';
      document.getElementById('reg-club').value = '';
      document.getElementById('reg-city').value = '';
      document.getElementById('reg-contacts').value = '';
      document.getElementById('reg-extra').value = '';
      loadRegistrations(currentTournamentId);
    } catch (error) {
      alert('Ошибка: ' + error.message);
    } finally {
      submitRegistrationBtn.disabled = false;
    }
  });
}

async function loadRegistrations(tournamentId, isCreator) {
  try {
    const registrations = await supabaseFetch(`registrations?tournament_id=eq.${tournamentId}&order=timestamp.asc`, 'GET');
    const registrationList = document.getElementById('registration-list');
    registrationList.innerHTML = '';
    const seen = new Set();
    const uniqueRegistrations = registrations.filter(reg => {
      const key = `${reg.tournament_id}|${reg.faction_name}|${reg.club}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (uniqueRegistrations.length > 0) {
      uniqueRegistrations.forEach(reg => {
        const regCard = document.createElement('div');
        regCard.classList.add('registration-card');
        regCard.setAttribute('data-registration-id', reg.id);
        regCard.innerHTML = `
          <strong>${reg.faction_name || 'Не указано'}</strong>
          <p>Клуб: ${reg.club || 'Не указано'}</p>
          <p>Спикер 1: ${reg.speaker1 || 'Не указано'}</p>
          <p>Спикер 2: ${reg.speaker2 || 'Не указано'}</p>
          <p>Город: ${reg.city || 'Не указано'}</p>
          <p>Контакты: ${reg.contacts || 'Не указано'}</p>
          <p>Дополнительно: ${reg.extra || 'Нет'}</p>
          ${isCreator ? `<button class="delete-registration-btn" data-registration-id="${reg.id}">Удалить</button>` : ''}
        `;
        registrationList.appendChild(regCard);
      });
      if (isCreator) {
        document.querySelectorAll('.delete-registration-btn').forEach(button => {
          button.onclick = async () => {
            const registrationId = button.getAttribute('data-registration-id');
            if (confirm('Удалить команду?')) await deleteRegistration(registrationId, tournamentId);
          };
        });
      }
    } else {
      registrationList.innerHTML = '<p>Пока нет зарегистрированных команд.</p>';
    }
  } catch (error) {
    alert('Ошибка загрузки регистраций: ' + error.message);
  }
}

async function deleteRegistration(registrationId, tournamentId) {
  try {
    await supabaseFetch(`registrations?id=eq.${registrationId}`, 'DELETE');
    alert('Команда удалена!');
    const isCreator = (await supabaseFetch(`tournaments?id=eq.${tournamentId}`, 'GET'))[0].creator_id === userData.telegramUsername;
    await loadRegistrations(tournamentId, isCreator);
  } catch (error) {
    alert('Ошибка при удалении: ' + error.message);
  }
}

function initBracket(isCreator) {
  const bracketSection = document.getElementById('tournament-bracket');
  bracketSection.innerHTML = '';
  if (isCreator) {
    bracketSection.innerHTML = `
      <div id="bracket-form">
        <select id="bracket-format">
          <option value="АПФ">АПФ</option>
          <option value="БПФ">БПФ</option>
        </select>
        <input id="bracket-faction-count" type="number" placeholder="Количество фракций (чётное)" min="2" step="2">
        <select id="bracket-round-count">
          <option value="1">1 раунд</option>
          <option value="2">2 раунда</option>
          <option value="3">3 раунда</option>
          <option value="4">4 раунда</option>
          <option value="5">5 раундов</option>
        </select>
        <button id="generate-bracket-btn">Сформировать сетку</button>
      </div>
      <div id="bracket-display"></div>
    `;
    document.getElementById('generate-bracket-btn').onclick = generateBracket;
  } else {
    bracketSection.innerHTML = `<div id="bracket-display"></div>`;
  }
}

async function generateBracket() {
  const format = document.getElementById('bracket-format').value;
  const factionCount = parseInt(document.getElementById('bracket-faction-count').value);
  const roundCount = parseInt(document.getElementById('bracket-round-count').value);
  if (isNaN(factionCount) || factionCount < 2 || factionCount % 2 !== 0) {
    alert('Количество фракций должно быть чётным и больше 0!');
    return;
  }
  if (format === 'БПФ' && factionCount % 4 !== 0) {
    alert('Для БПФ количество фракций должно быть кратно 4!');
    return;
  }
  const registrations = await supabaseFetch(`registrations?tournament_id=eq.${currentTournamentId}&order=timestamp.asc`, 'GET');
  if (!registrations || registrations.length < factionCount) {
    alert('Недостаточно команд!');
    return;
  }
  const teams = registrations.slice(0, factionCount).map(reg => ({
    faction_name: reg.faction_name,
    club: reg.club
  }));
  const positions = format === 'АПФ' ? ['Правительство', 'Оппозиция'] : ['ОП', 'ОО', 'ЗП', 'ЗО'];
  const teamsPerMatch = format === 'АПФ' ? 2 : 4;
  const matches = [];
  const usedPairs = new Set();
  for (let round = 0; round < roundCount; round++) {
    const roundMatches = [];
    const availableTeams = [...teams];
    while (availableTeams.length >= teamsPerMatch) {
      const matchTeams = [];
      for (let i = 0; i < teamsPerMatch; i++) {
        const randomIndex = Math.floor(Math.random() * availableTeams.length);
        matchTeams.push(availableTeams.splice(randomIndex, 1)[0]);
      }
      const matchKey = matchTeams.map(team => team.faction_name).sort().join('|');
      if (usedPairs.has(matchKey)) {
        availableTeams.push(...matchTeams);
        continue;
      }
      usedPairs.add(matchKey);
      const match = {
        teams: matchTeams.map((team, idx) => ({
          faction_name: team.faction_name,
          club: team.club,
          position: positions[idx]
        })),
        room: '',
        judge: ''
      };
      roundMatches.push(match);
    }
    if (roundMatches.length > 0) matches.push({ round: round + 1, matches: roundMatches });
  }
  const bracket = {
    tournament_id: currentTournamentId,
    format,
    faction_count: factionCount,
    round_count: roundCount,
    matches,
    published: false,
    timestamp: new Date().toISOString()
  };
  try {
    await supabaseFetch('brackets', 'POST', bracket);
    loadBracket(currentTournamentId);
  } catch (error) {
    alert('Ошибка: ' + error.message);
  }
}

async function loadBracket(tournamentId) {
  const bracketDisplay = document.getElementById('bracket-display');
  try {
    const brackets = await supabaseFetch(`brackets?tournament_id=eq.${tournamentId}&order=timestamp.desc`, 'GET');
    bracketDisplay.innerHTML = '';
    if (brackets?.length > 0) {
      const bracket = brackets[0];
      bracket.matches.forEach(round => {
        const roundDiv = document.createElement('div');
        roundDiv.classList.add('bracket-round');
        roundDiv.innerHTML = `<h3>Раунд ${round.round}</h3>`;
        round.matches.forEach(match => {
          const matchDiv = document.createElement('div');
          matchDiv.classList.add('bracket-match');
          matchDiv.innerHTML = `
            <p>Комната: ${match.room || 'Не указана'}</p>
            <p>Судья: ${match.judge || 'Не указан'}</p>
            <ul>${match.teams.map(team => `<li>${team.position}: ${team.faction_name} (${team.club})</li>`).join('')}</ul>
          `;
          roundDiv.appendChild(matchDiv);
        });
        bracketDisplay.appendChild(roundDiv);
      });
    } else {
      bracketDisplay.innerHTML = '<p>Сетка не сформирована.</p>';
    }
  } catch (error) {
    bracketDisplay.innerHTML = '<p>Ошибка загрузки сетки.</p>';
  }
}

function initRating() {
  const cityButtons = document.querySelectorAll('#city-selector .city-btn');
  const seasonSelector = document.getElementById('season-selector');
  const seasonButtons = document.querySelectorAll('#season-selector .season-btn');
  const ratingTable = document.getElementById('rating-table');
  seasonSelector.style.display = 'none';
  ratingTable.style.display = 'none';
  cityButtons.forEach(button => {
    button.addEventListener('click', () => {
      cityButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      const selectedCity = button.dataset.city;
      if (selectedCity === 'Almaty') {
        seasonSelector.style.display = 'flex';
        ratingTable.style.display = 'none';
      } else {
        seasonSelector.style.display = 'none';
        ratingTable.style.display = 'none';
        ratingTable.innerHTML = '<p>Рейтинг для этого города недоступен.</p>';
      }
    });
  });
  seasonButtons.forEach(button => {
    button.addEventListener('click', () => {
      seasonButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      const selectedSeason = button.dataset.season;
      if (selectedSeason === '2024-2025') {
        renderRatingTable();
      } else {
        ratingTable.style.display = 'none';
        ratingTable.innerHTML = '<p>Рейтинг для этого сезона недоступен.</p>';
      }
    });
  });
}

function renderRatingTable() {
  const ratingTable = document.getElementById('rating-table');
  ratingTable.style.display = 'block';
  ratingTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Место</th>
          <th>Имя</th>
          <th>Очки</th>
          <th>Клуб</th>
        </tr>
      </thead>
      <tbody>
        ${ratingData.map(player => `
          <tr class="${player.rank === 1 ? 'rank-1' : player.rank === 2 ? 'rank-2' : player.rank === 3 ? 'rank-3' : ''}">
            <td>${player.rank}</td>
            <td>${player.name}</td>
            <td>${player.points}</td>
            <td>${player.club}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

checkProfile();
