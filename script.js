// Подключаем Supabase клиент
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
let lastPostId = null; // Для пагинации и отслеживания новых постов
let currentTournamentId = null;
let isPostsLoaded = false;
let isLoadingMore = false; // Флаг для предотвращения множественных загрузок
let newPostsCount = 0; // Счётчик новых постов для кнопки "Новые посты"
let channel = null; // Для управления Realtime-подпиской на посты
let commentChannels = new Map(); // Для управления Realtime-подписками на комментарии
let commentsCache = new Map(); // Кэш комментариев по postId
let lastCommentIds = new Map(); // Последний ID комментария для каждого поста
let newCommentsCount = new Map(); // Счётчик новых комментариев для каждого поста

async function supabaseFetch(endpoint, method, body = null, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
                method: method,
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': method === 'POST' || method === 'PATCH' ? 'return=representation' : undefined
                },
                body: body ? JSON.stringify(body) : null
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Supabase error: ${response.status} - ${errorText}`);
            }
            const text = await response.text();
            return text ? JSON.parse(text) : null;
        } catch (error) {
            if (attempt === retries) throw error;
            console.warn(`Retrying request (${attempt}/${retries})...`, error);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Экспоненциальная задержка
        }
    }
}

async function checkProfile() {
    const telegramUsername = tg.initDataUnsafe.user ? tg.initDataUnsafe.user.username : null;
    if (!telegramUsername) {
        alert('Telegram username недоступен! Укажите username в настройках Telegram.');
        return;
    }
    userData.telegramUsername = telegramUsername;

    try {
        const profiles = await supabaseFetch(`profiles?telegram_username=eq.${telegramUsername}`, 'GET');
        if (profiles && profiles.length > 0) {
            userData.fullname = profiles[0].fullname;
            showApp();
        } else {
            registrationModal.style.display = 'block';
        }
    } catch (error) {
        console.error('Error checking profile:', error);
        registrationModal.style.display = 'block';
    }
}

submitProfileRegBtn.addEventListener('click', async () => {
    if (!regFullname.value.trim()) {
        alert('Пожалуйста, введите имя!');
        return;
    }
    userData.fullname = regFullname.value.trim();
    try {
        await supabaseFetch('profiles', 'POST', {
            telegram_username: userData.telegramUsername,
            fullname: userData.fullname
        });
        registrationModal.style.display = 'none';
        showApp();
    } catch (error) {
        console.error('Error saving profile:', error);
        alert('Ошибка: ' + error.message);
    }
});

function showApp() {
    appContainer.style.display = 'block';
    document.getElementById('username').textContent = userData.telegramUsername;
    document.getElementById('fullname').value = userData.fullname;
    loadPosts();
    subscribeToNewPosts();
}

const sections = document.querySelectorAll('.content');
const buttons = document.querySelectorAll('.nav-btn');

function debounce(func, wait) {
    let timeout;
    return function (...args) {
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
        if (button.id === 'feed-btn') {
            debouncedLoadPosts();
        }
        if (button.id === 'tournaments-btn') loadTournaments();
    });
});

const debouncedLoadPosts = debounce(loadPosts, 300);

const updateProfileBtn = document.getElementById('update-profile');
updateProfileBtn.addEventListener('click', async () => {
    const newFullname = document.getElementById('fullname').value.trim();
    if (!newFullname) {
        alert('Пожалуйста, введите новое имя!');
        return;
    }
    userData.fullname = newFullname;
    try {
        await supabaseFetch(`profiles?telegram_username=eq.${userData.telegramUsername}`, 'PATCH', {
            fullname: userData.fullname
        });
        alert('Имя обновлено!');
    } catch (error) {
        console.error('Error updating profile:', error);
        alert('Ошибка: ' + error.message);
    }
});

const postText = document.getElementById('post-text');
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

submitPost.addEventListener('click', async () => {
    const postContent = postText.value.trim();
    if (!postContent) {
        alert('Пожалуйста, введите текст поста! Пустые посты не допускаются.');
        return;
    }
    const text = `${userData.fullname} (@${userData.telegramUsername}):\n${postContent}`;
    const post = {
        text: text,
        timestamp: new Date().toISOString(),
        user_id: userData.telegramUsername
    };
    try {
        const newPost = await supabaseFetch('posts', 'POST', post);
        postText.value = '';
        if (!postsCache.some(p => p.id === newPost[0].id)) {
            postsCache.unshift(newPost[0]);
            sortPostsCache();
            if (isUserAtTop()) {
                renderNewPost(newPost[0], true);
            } else {
                newPostsCount++;
                newPostsBtn.style.display = 'block';
                newPostsBtn.classList.add('visible');
            }
            lastPostId = postsCache[0].id;
        }
    } catch (error) {
        console.error('Error saving post:', error);
        alert('Ошибка: ' + error.message);
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
            if (postsCache.length > 0) {
                lastPostId = postsCache[0].id;
            }
            isPostsLoaded = true;
        }
    } catch (error) {
        console.error('Error loading posts:', error);
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
        if (morePosts && morePosts.length > 0) {
            const newPosts = morePosts.filter(post => !postsCache.some(p => p.id === post.id));
            if (newPosts.length > 0) {
                postsCache.push(...newPosts);
                sortPostsCache();
                renderMorePosts(newPosts);
            }
        }
    } catch (error) {
        console.error('Error loading more posts:', error);
    } finally {
        isLoadingMore = false;
    }
}

async function loadNewPosts() {
    try {
        const newPosts = await supabaseFetch(`posts?id=gt.${lastPostId}&order=id.desc`, 'GET');
        if (newPosts && newPosts.length > 0) {
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
    if (channel) {
        supabaseClient.removeChannel(channel);
    }

    channel = supabaseClient
        .channel('posts-channel')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, (payload) => {
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
                    newPostsBtn.classList.add('visible');
                }
            }
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('Subscribed to posts channel');
            } else {
                console.error('Failed to subscribe to posts channel:', status);
            }
        });
}

function isUserAtTop() {
    const feedSection = document.getElementById('feed');
    return feedSection.scrollTop <= 50;
}

function setupInfiniteScroll() {
    const feedSection = document.getElementById('feed');
    feedSection.removeEventListener('scroll', debouncedLoadMorePosts);
    feedSection.addEventListener('scroll', debouncedLoadMorePosts);
}

const debouncedLoadMorePosts = debounce(() => {
    const feedSection = document.getElementById('feed');
    if (feedSection.scrollHeight - feedSection.scrollTop <= feedSection.clientHeight + 100) {
        loadMorePosts();
    }
}, 300);

function sortPostsCache() {
    postsCache.sort((a, b) => b.id - a.id);
}

function renderPosts() {
    postsDiv.innerHTML = '';
    for (const post of postsCache) {
        renderNewPost(post, false);
    }
}

function renderNewPosts(newPosts, prepend = false) {
    for (const post of newPosts) {
        renderNewPost(post, prepend);
    }
}

function renderNewPost(post, prepend = false) {
    const postDiv = document.createElement('div');
    postDiv.classList.add('post');
    postDiv.setAttribute('data-post-id', post.id);

    const [userInfo, ...contentParts] = post.text.split(':\n');
    const [fullname, username] = userInfo.split(' (@');
    const cleanUsername = username ? username.replace(')', '') : '';
    const content = contentParts.join(':\n');

    const timeAgo = getTimeAgo(new Date(post.timestamp));

    postDiv.innerHTML = `
        <div class="post-header">
            <div class="post-user">
                <strong>${fullname}</strong>
                <span>@${cleanUsername}</span>
            </div>
            <div class="post-time">${timeAgo}</div>
        </div>
        <div class="post-content">${content}</div>
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

    if (prepend) {
        postsDiv.prepend(postDiv);
    } else {
        postsDiv.appendChild(postDiv);
    }

    loadReactionsAndComments(post.id);
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

        const timeAgo = getTimeAgo(new Date(post.timestamp));

        postDiv.innerHTML = `
            <div class="post-header">
                <div class="post-user">
                    <strong>${fullname}</strong>
                    <span>@${cleanUsername}</span>
                </div>
                <div class="post-time">${timeAgo}</div>
            </div>
            <div class="post-content">${content}</div>
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
    }
}

async function loadReactionsAndComments(postId) {
    try {
        const reactions = await loadReactions(postId);
        const likes = reactions.filter(r => r.type === 'like').length;
        const dislikes = reactions.filter(r => r.type === 'dislike').length;
        const userReaction = reactions.find(r => r.user_id === userData.telegramUsername);
        const likeClass = userReaction && userReaction.type === 'like' ? 'active' : '';
        const dislikeClass = userReaction && userReaction.type === 'dislike' ? 'active' : '';

        const comments = await loadComments(postId);
        const commentCount = comments ? comments.length : 0;

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

            if (comments) {
                await renderComments(postId, comments);
            }

            setupCommentInfiniteScroll(postId);
        }
    } catch (error) {
        console.error('Error loading reactions and comments:', error);
    }
}

async function updatePost(postId) {
    const postIndex = postsCache.findIndex(post => post.id === postId);
    if (postIndex === -1) return;

    const post = await supabaseFetch(`posts?id=eq.${postId}`, 'GET');
    if (!post || post.length === 0) return;

    const reactions = await loadReactions(postId);
    const likes = reactions.filter(r => r.type === 'like').length;
    const dislikes = reactions.filter(r => r.type === 'dislike').length;
    const userReaction = reactions.find(r => r.user_id === userData.telegramUsername);
    const likeClass = userReaction && userReaction.type === 'like' ? 'active' : '';
    const dislikeClass = userReaction && userReaction.type === 'dislike' ? 'active' : '';

    const comments = await loadComments(postId);
    const commentCount = comments ? comments.length : 0;

    postsCache[postIndex] = post[0];
    const postDiv = postsDiv.querySelector(`[data-post-id="${postId}"]`);
    if (!postDiv) return;

    const [userInfo, ...contentParts] = post[0].text.split(':\n');
    const [fullname, username] = userInfo.split(' (@');
    const cleanUsername = username ? username.replace(')', '') : '';
    const content = contentParts.join(':\n');

    const timeAgo = getTimeAgo(new Date(post[0].timestamp));

    postDiv.innerHTML = `
        <div class="post-header">
            <div class="post-user">
                <strong>${fullname}</strong>
                <span>@${cleanUsername}</span>
            </div>
            <div class="post-time">${timeAgo}</div>
        </div>
        <div class="post-content">${content}</div>
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

    if (comments) {
        await renderComments(postId, comments);
    }

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
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays}d`;
}

async function loadReactions(postId) {
    try {
        const reactions = await supabaseFetch(`reactions?post_id=eq.${postId}`, 'GET');
        return reactions || [];
    } catch (error) {
        console.error('Error loading reactions:', error);
        return [];
    }
}

async function toggleReaction(postId, type) {
    postId = parseInt(postId);
    try {
        const userExists = await supabaseFetch(`profiles?telegram_username=eq.${userData.telegramUsername}`, 'GET');
        if (!userExists || userExists.length === 0) {
            throw new Error('Пользователь не найден в базе данных. Пожалуйста, зарегистрируйтесь.');
        }

        const userReaction = await supabaseFetch(`reactions?post_id=eq.${postId}&user_id=eq.${userData.telegramUsername}`, 'GET');
        
        if (userReaction && userReaction.length > 0) {
            const currentReaction = userReaction[0];
            if (currentReaction.type === type) {
                await supabaseFetch(`reactions?id=eq.${currentReaction.id}`, 'DELETE');
            } else {
                await supabaseFetch(`reactions?id=eq.${currentReaction.id}`, 'PATCH', { type: type });
            }
        } else {
            await supabaseFetch('reactions', 'POST', {
                post_id: postId,
                user_id: userData.telegramUsername,
                type: type,
                timestamp: new Date().toISOString()
            });
        }
        await updatePost(postId);
    } catch (error) {
        console.error('Error toggling reaction:', error);
        alert('Ошибка: ' + error.message);
    }
}

// Новые функции для комментариев
async function loadComments(postId) {
    try {
        // Инициализируем кэш для этого поста, если его нет
        if (!commentsCache.has(postId)) {
            commentsCache.set(postId, []);
            lastCommentIds.set(postId, null);
            newCommentsCount.set(postId, 0);
        }

        // Загружаем первые 10 комментариев
        const comments = await supabaseFetch(`comments?post_id=eq.${postId}&order=id.asc&limit=10`, 'GET');
        if (comments && comments.length > 0) {
            const currentComments = commentsCache.get(postId);
            const newComments = comments.filter(comment => !currentComments.some(c => c.id === comment.id));
            commentsCache.set(postId, [...newComments, ...currentComments]);
            sortCommentsCache(postId);
            if (newComments.length > 0) {
                lastCommentIds.set(postId, commentsCache.get(postId)[commentsCache.get(postId).length - 1].id);
            }
        }
        return commentsCache.get(postId);
    } catch (error) {
        console.error('Error loading comments:', error);
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
        if (moreComments && moreComments.length > 0) {
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
        if (newComments && newComments.length > 0) {
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
    // Удаляем старую подписку, если она существует
    if (commentChannels.has(postId)) {
        supabaseClient.removeChannel(commentChannels.get(postId));
    }

    const channel = supabaseClient
        .channel(`comments-channel-${postId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` }, (payload) => {
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
                        newCommentsBtn.classList.add('visible');
                    }
                }
            }
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log(`Subscribed to comments channel for post ${postId}`);
            } else {
                console.error(`Failed to subscribe to comments channel for post ${postId}:`, status);
            }
        });

    commentChannels.set(postId, channel);
}

function isUserAtBottom(postId) {
    const commentList = document.getElementById(`comment-list-${postId}`);
    if (!commentList) return false;
    return commentList.scrollHeight - commentList.scrollTop <= commentList.clientHeight + 50;
}

function setupCommentInfiniteScroll(postId) {
    const commentList = document.getElementById(`comment-list-${postId}`);
    if (!commentList) return;

    // Удаляем старую подписку на комментарии
    if (commentChannels.has(postId)) {
        supabaseClient.removeChannel(commentChannels.get(postId));
        commentChannels.delete(postId);
    }

    const debouncedLoadMoreComments = debounce(() => {
        if (commentList.scrollTop <= 50) {
            loadMoreComments(postId);
        }
    }, 300);

    commentList.removeEventListener('scroll', debouncedLoadMoreComments);
    commentList.addEventListener('scroll', debouncedLoadMoreComments);

    // Подписываемся на новые комментарии
    subscribeToNewComments(postId);

    // Добавляем обработчик для кнопки "Новые комментарии"
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
        comments.sort((a, b) => a.id - b.id); // Сортировка по id (старые комментарии вверху)
        commentsCache.set(postId, comments);
    }
}

async function renderComments(postId, comments) {
    const commentList = document.getElementById(`comment-list-${postId}`);
    if (!commentList) return;
    commentList.innerHTML = '';
    comments.forEach(comment => {
        renderNewComment(postId, comment, false);
    });
}

async function renderNewComments(postId, newComments, append = false) {
    for (const comment of newComments) {
        renderNewComment(postId, comment, append);
    }
}

function renderNewComment(postId, comment, append = false) {
    const commentList = document.getElementById(`comment-list-${postId}`);
    if (!commentList) return;

    const commentDiv = document.createElement('div');
    commentDiv.classList.add('comment');
    const [userInfo, ...contentParts] = comment.text.split(':\n');
    const [fullname, username] = userInfo.split(' (@');
    const cleanUsername = username ? username.replace(')', '') : '';
    const content = contentParts.join(':\n');
    commentDiv.innerHTML = `
        <div class="comment-user">
            <strong>${fullname}</strong> <span>@${cleanUsername}</span>
        </div>
        <div class="comment-content">${content}</div>
    `;

    if (append) {
        commentList.appendChild(commentDiv);
        // Прокручиваем вниз, если пользователь внизу
        if (isUserAtBottom(postId)) {
            commentList.scrollTop = commentList.scrollHeight;
        }
    } else {
        commentList.prepend(commentDiv);
    }
}

async function renderMoreComments(postId, newComments) {
    for (const comment of newComments) {
        const commentList = document.getElementById(`comment-list-${postId}`);
        if (!commentList) return;

        const commentDiv = document.createElement('div');
        commentDiv.classList.add('comment');
        const [userInfo, ...contentParts] = comment.text.split(':\n');
        const [fullname, username] = userInfo.split(' (@');
        const cleanUsername = username ? username.replace(')', '') : '';
        const content = contentParts.join(':\n');
        commentDiv.innerHTML = `
            <div class="comment-user">
                <strong>${fullname}</strong> <span>@${cleanUsername}</span>
            </div>
            <div class="comment-content">${content}</div>
        `;
        commentList.prepend(commentDiv);
    }
}

async function addComment(postId) {
    postId = parseInt(postId);
    const commentInput = document.getElementById(`comment-input-${postId}`);
    if (!commentInput) return;
    const text = commentInput.value.trim();
    if (!text) {
        alert('Пожалуйста, введите текст комментария!');
        return;
    }

    try {
        const postExists = await supabaseFetch(`posts?id=eq.${postId}`, 'GET');
        if (!postExists || postExists.length === 0) {
            throw new Error('Пост не найден. Возможно, он был удалён.');
        }

        const userExists = await supabaseFetch(`profiles?telegram_username=eq.${userData.telegramUsername}`, 'GET');
        if (!userExists || userExists.length === 0) {
            throw new Error('Пользователь не найден в базе данных. Пожалуйста, зарегистрируйтесь.');
        }

        const comment = {
            post_id: postId,
            user_id: userData.telegramUsername,
            text: `${userData.fullname} (@${userData.telegramUsername}):\n${text}`,
            timestamp: new Date().toISOString()
        };

        const newComment = await supabaseFetch('comments', 'POST', comment);
        commentInput.value = '';

        // Добавляем комментарий в кэш
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
                    newCommentsBtn.classList.add('visible');
                }
            }
        }

        // Обновляем счётчик комментариев
        await updatePost(postId);
    } catch (error) {
        console.error('Error adding comment:', error);
        alert('Ошибка: ' + error.message);
    }
}

function toggleComments(postId) {
    const commentSection = document.getElementById(`comments-${postId}`);
    if (commentSection) {
        const isVisible = commentSection.style.display === 'block';
        commentSection.style.display = isVisible ? 'none' : 'block';

        if (!isVisible) {
            // Загружаем комментарии и подписываемся на обновления
            loadComments(postId).then(comments => renderComments(postId, comments));
            setupCommentInfiniteScroll(postId);
        } else {
            // Отписываемся от обновлений
            if (commentChannels.has(postId)) {
                supabaseClient.removeChannel(commentChannels.get(postId));
                commentChannels.delete(postId);
            }
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
        console.error('Error saving tournament:', error);
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
        console.error('Error loading tournaments:', error);
        alert('Ошибка загрузки турниров: ' + error.message);
    }
}

async function showTournamentDetails(tournamentId) {
    try {
        const tournament = await supabaseFetch(`tournaments?id=eq.${tournamentId}`, 'GET');
        if (!tournament || tournament.length === 0) return;

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
        description.innerHTML = `
            <p>Описание: ${data.desc || 'Описание отсутствует'}</p>
        `;

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
        console.error('Error loading tournament details:', error);
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
            const text = document.getElementById('tournament-post-text').value.trim();
            if (!text) {
                alert('Пожалуйста, введите текст поста!');
                return;
            }
            try {
                await supabaseFetch('tournament_posts', 'POST', {
                    tournament_id: currentTournamentId,
                    creator_id: userData.telegramUsername,
                    text: text,
                    timestamp: new Date().toISOString()
                });
                document.getElementById('tournament-post-text').value = '';
                loadTournamentPosts(currentTournamentId);
            } catch (error) {
                console.error('Error saving tournament post:', error);
                alert('Ошибка: ' + error.message);
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
        if (posts && posts.length > 0) {
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
        console.error('Error loading tournament posts:', error);
        postsList.innerHTML = '<p>Ошибка загрузки постов.</p>';
    }
}

function initRegistration() {
    const registerBtn = document.getElementById('register-tournament-btn');
    const registrationForm = document.getElementById('registration-form');
    const submitRegistrationBtn = document.getElementById('submit-registration-btn');

    registerBtn.onclick = () => {
        registrationForm.classList.toggle('form-hidden');
    };

    submitRegistrationBtn.addEventListener('click', async () => {
        // Отключаем кнопку, чтобы предотвратить повторные клики
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
            alert('Пожалуйста, укажите название фракции!');
            submitRegistrationBtn.disabled = false;
            return;
        }
        if (!registration.club) {
            alert('Пожалуйста, укажите название клуба!');
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
            console.error('Error saving registration:', error);
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

        // Удаляем возможные дубли на клиентской стороне
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
                const deleteButtons = document.querySelectorAll('.delete-registration-btn');
                deleteButtons.forEach(button => {
                    button.onclick = async () => {
                        const registrationId = button.getAttribute('data-registration-id');
                        if (confirm('Вы уверены, что хотите удалить эту команду?')) {
                            await deleteRegistration(registrationId, tournamentId);
                        }
                    };
                });
            }
        } else {
            registrationList.innerHTML = '<p>Пока нет зарегистрированных команд.</p>';
        }
    } catch (error) {
        console.error('Error loading registrations:', error);
        alert('Ошибка загрузки регистраций: ' + error.message);
    }
}

async function deleteRegistration(registrationId, tournamentId) {
    try {
        await supabaseFetch(`registrations?id=eq.${registrationId}`, 'DELETE');
        alert('Команда успешно удалена!');
        const isCreator = (await supabaseFetch(`tournaments?id=eq.${tournamentId}`, 'GET'))[0].creator_id === userData.telegramUsername;
        await loadRegistrations(tournamentId, isCreator);
    } catch (error) {
        console.error('Error deleting registration:', error);
        alert('Ошибка при удалении команды: ' + error.message);
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
        document.getElementById('generate-bracket-btn').onclick = async () => {
            generateBracket();
        };
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
        alert('Для формата БПФ количество фракций должно быть кратно 4!');
        return;
    }

    const registrations = await supabaseFetch(`registrations?tournament_id=eq.${currentTournamentId}&order=timestamp.asc`, 'GET');
    if (!registrations || registrations.length < factionCount) {
        alert('Недостаточно зарегистрированных команд!');
        return;
    }

    const teams = registrations.slice(0, factionCount).map(reg => ({
        faction_name: reg.faction_name,
        club: reg.club
    }));
    const positions = format === 'АПФ' ? ['Правительство', 'Оппозиция'] : ['Открывающая Правительство', 'Открывающая Оппозиция', 'Закрывающая Правительство', 'Закрывающая Оппозиция'];
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
        if (roundMatches.length > 0) {
            matches.push({ round: round + 1, matches: roundMatches });
        }
    }

    const bracket = {
        tournament_id: currentTournamentId,
        format: format,
        faction_count: factionCount,
        round_count: roundCount,
        matches: matches,
        published: false,
        timestamp: new Date().toISOString()
    };

    try {
        await supabaseFetch('brackets', 'POST', bracket);
        loadBracket(currentTournamentId);
    } catch (error) {
        console.error('Error saving bracket:', error);
        alert('Ошибка: ' + error.message);
    }
}

async function loadBracket(tournamentId) {
    const bracketSection = document.getElementById('tournament-bracket');
    const bracketDisplay = document.getElementById('bracket-display');
    const isCreator = (await supabaseFetch(`tournaments?id=eq.${tournamentId}`, 'GET'))[0].creator_id === userData.telegramUsername;

    try {
        const bracket = await supabaseFetch(`brackets?tournament_id=eq.${tournamentId}&order=timestamp.desc&limit=1`, 'GET');
        if (!bracket || bracket.length === 0) {
            bracketDisplay.innerHTML = '<p>Сетка ещё не сформирована.</p>';
            return;
        }

        const data = bracket[0];
        bracketDisplay.innerHTML = '';

        if (data.published || isCreator) {
            data.matches.forEach(round => {
                const roundDiv = document.createElement('div');
                roundDiv.classList.add('bracket-round');
                roundDiv.innerHTML = `<h3>Раунд ${round.round}</h3>`;
                
                round.matches.forEach((match, matchIdx) => {
                    const matchDiv = document.createElement('div');
                    matchDiv.classList.add('bracket-match');
                    let matchHTML = '';
                    match.teams.forEach(team => {
                        matchHTML += `
                            <p>${team.position}: ${team.faction_name} <span class="team-club">(${team.club})</span></p>
                        `;
                    });
                    if (isCreator && !data.published) {
                        matchHTML += `
                            <input type="text" id="room-input-${round.round}-${matchIdx}" name="room-${round.round}-${matchIdx}" placeholder="Кабинет" value="${match.room || ''}" data-round="${round.round}" data-match="${matchIdx}" class="room-input">
                            <input type="text" id="judge-input-${round.round}-${matchIdx}" name="judge-${round.round}-${matchIdx}" placeholder="Судья" value="${match.judge || ''}" data-round="${round.round}" data-match="${matchIdx}" class="judge-input">
                        `;
                    } else if (data.published) {
                        matchHTML += `
                            <p>Кабинет: ${match.room || 'Не указан'}</p>
                            <p>Судья: ${match.judge || 'Не указан'}</p>
                        `;
                    }
                    matchDiv.innerHTML = matchHTML;
                    roundDiv.appendChild(matchDiv);
                });
                bracketDisplay.appendChild(roundDiv);
            });

            if (isCreator && !data.published) {
                const publishBtn = document.createElement('button');
                publishBtn.id = 'publish-bracket-btn';
                publishBtn.textContent = 'Опубликовать';
                publishBtn.onclick = async () => {
                    const updatedMatches = data.matches.map(round => ({
                        round: round.round,
                        matches: round.matches.map((match, matchIdx) => ({
                            teams: match.teams,
                            room: document.querySelector(`.room-input[data-round="${round.round}"][data-match="${matchIdx}"]`).value,
                            judge: document.querySelector(`.judge-input[data-round="${round.round}"][data-match="${matchIdx}"]`).value
                        }))
                    }));
                    await supabaseFetch(`brackets?id=eq.${data.id}`, 'PATCH', { matches: updatedMatches, published: true });
                    loadBracket(tournamentId);
                };
                bracketDisplay.appendChild(publishBtn);
            }
        } else {
            bracketDisplay.innerHTML = '<p>Сетка ещё не опубликована.</p>';
        }
    } catch (error) {
        console.error('Error loading bracket:', error);
        bracketDisplay.innerHTML = '<p>Ошибка загрузки сетки.</p>';
    }
}

const ratingList = document.getElementById('rating-list');
const rating = [
    { name: 'Иван Иванов', points: 150 },
    { name: 'Анна Петрова', points: 120 }
];

rating.forEach(player => {
    const div = document.createElement('div');
    div.classList.add('post');
    div.innerHTML = `<strong>${player.name}</strong> - ${player.points} очков`;
    ratingList.appendChild(div);
});

checkProfile();
