const tg = window.Telegram.WebApp;
tg.ready();

const registrationModal = document.getElementById('registration-modal');
const appContainer = document.getElementById('app-container');
const regFullname = document.getElementById('reg-fullname');
const submitProfileRegBtn = document.getElementById('submit-profile-reg-btn');
let userData = {};
let postsCache = [];
let lastPostTimestamp = null;

async function supabaseFetch(endpoint, method, body = null) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
        method: method,
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': method === 'POST' ? 'return=representation' : undefined
        },
        body: body ? JSON.stringify(body) : null
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Supabase error: ${response.status} - ${errorText}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
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
    startNewPostCheck();
}

const sections = document.querySelectorAll('.content');
const buttons = document.querySelectorAll('.nav-btn');

buttons.forEach(button => {
    button.addEventListener('click', () => {
        buttons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        sections.forEach(section => section.classList.remove('active'));
        const targetSection = document.getElementById(button.id.replace('-btn', ''));
        targetSection.classList.add('active');
        if (button.id === 'feed-btn') loadPosts();
        if (button.id === 'tournaments-btn') loadTournaments();
    });
});

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
        timestamp: new Date().toISOString()
    };
    try {
        const newPost = await supabaseFetch('posts', 'POST', post);
        postText.value = '';
        postsCache.unshift(newPost[0]);
        sortPostsCache();
        renderPosts(); // Здесь полное обновление нужно, так как добавляется новый пост
        lastPostTimestamp = postsCache[0].timestamp;
    } catch (error) {
        console.error('Error saving post:', error);
        alert('Ошибка: ' + error.message);
    }
});

async function loadPosts() {
    try {
        postsCache = [];
        const posts = await supabaseFetch('posts?order=timestamp.desc&limit=20', 'GET');
        if (posts) {
            postsCache = posts;
            sortPostsCache();
            renderPosts();
            if (postsCache.length > 0) {
                lastPostTimestamp = postsCache[0].timestamp;
            }
        }
    } catch (error) {
        console.error('Error loading posts:', error);
        alert('Ошибка загрузки постов: ' + error.message);
    }
}

async function loadNewPosts() {
    try {
        const newPosts = await supabaseFetch(`posts?timestamp=gt.${lastPostTimestamp}&order=timestamp.desc`, 'GET');
        if (newPosts && newPosts.length > 0) {
            postsCache.unshift(...newPosts);
            sortPostsCache();
            renderPosts(); // Здесь тоже полное обновление, так как добавляются новые посты
            lastPostTimestamp = postsCache[0].timestamp;
        }
    } catch (error) {
        console.error('Error loading new posts:', error);
    }
}

function startNewPostCheck() {
    setInterval(async () => {
        if (!lastPostTimestamp) return;
        try {
            const newPosts = await supabaseFetch(`posts?timestamp=gt.${lastPostTimestamp}&order=timestamp.desc&limit=1`, 'GET');
            if (newPosts && newPosts.length > 0) {
                newPostsBtn.style.display = 'block';
            }
        } catch (error) {
            console.error('Error checking for new posts:', error);
        }
    }, 10000); // Проверяем каждые 10 секунд
}

function sortPostsCache() {
    postsCache.sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        if (timeA === timeB) {
            return b.id - a.id;
        }
        return timeB - timeA;
    });
}

async function renderPosts() {
    postsDiv.innerHTML = '';
    for (const post of postsCache) {
        await renderPost(post);
    }
}

async function renderPost(post) {
    const postDiv = document.createElement('div');
    postDiv.classList.add('post');
    postDiv.setAttribute('data-post-id', post.id);

    const [userInfo, ...contentParts] = post.text.split(':\n');
    const [fullname, username] = userInfo.split(' (@');
    const cleanUsername = username ? username.replace(')', '') : '';
    const content = contentParts.join(':\n');

    const timeAgo = getTimeAgo(new Date(post.timestamp));

    const reactions = await loadReactions(post.id);
    const likes = reactions.filter(r => r.type === 'like').length;
    const dislikes = reactions.filter(r => r.type === 'dislike').length;
    const userReaction = reactions.find(r => r.user_id === userData.telegramUsername);
    const likeClass = userReaction && userReaction.type === 'like' ? 'active' : '';
    const dislikeClass = userReaction && userReaction.type === 'dislike' ? 'active' : '';

    const comments = await loadComments(post.id);
    const commentCount = comments ? comments.length : 0;

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
            <button class="reaction-btn like-btn ${likeClass}" onclick="toggleReaction(${post.id}, 'like')">👍 ${likes}</button>
            <button class="reaction-btn dislike-btn ${dislikeClass}" onclick="toggleReaction(${post.id}, 'dislike')">👎 ${dislikes}</button>
            <button class="comment-toggle-btn" onclick="toggleComments(${post.id})">💬 Комментарии (${commentCount})</button>
        </div>
        <div class="comment-section" id="comments-${post.id}" style="display: none;">
            <div class="comment-list" id="comment-list-${post.id}"></div>
            <div class="comment-form">
                <textarea class="comment-input" id="comment-input-${post.id}" placeholder="Написать комментарий..."></textarea>
                <button onclick="addComment(${post.id})">Отправить</button>
            </div>
        </div>
    `;

    postsDiv.appendChild(postDiv);

    if (comments) {
        await renderComments(post.id, comments);
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
    postsCache[postIndex].likes = likes;
    postsCache[postIndex].dislikes = dislikes;
    postsCache[postIndex].comment_count = commentCount;

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
            <div class="comment-list" id="comment-list-${postId}"></div>
            <div class="comment-form">
                <textarea class="comment-input" id="comment-input-${postId}" placeholder="Написать комментарий..."></textarea>
                <button onclick="addComment(${postId})">Отправить</button>
            </div>
        </div>
    `;

    if (comments) {
        await renderComments(postId, comments);
    }
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
        await updatePost(postId); // Обновляем только этот пост
    } catch (error) {
        console.error('Error toggling reaction:', error);
        alert('Ошибка: ' + error.message);
    }
}

async function loadComments(postId) {
    try {
        const comments = await supabaseFetch(`comments?post_id=eq.${postId}&order=timestamp.asc`, 'GET');
        return comments || [];
    } catch (error) {
        console.error('Error loading comments:', error);
        return [];
    }
}

async function renderComments(postId, comments) {
    const commentList = document.getElementById(`comment-list-${postId}`);
    if (!commentList) return;
    commentList.innerHTML = '';
    comments.forEach(comment => {
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
        commentList.appendChild(commentDiv);
    });
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

        await supabaseFetch('comments', 'POST', comment);
        commentInput.value = '';
        await updatePost(postId); // Обновляем только этот пост
    } catch (error) {
        console.error('Error adding comment:', error);
        alert('Ошибка: ' + error.message);
    }
}

function toggleComments(postId) {
    const commentSection = document.getElementById(`comments-${postId}`);
    if (commentSection) {
        commentSection.style.display = commentSection.style.display === 'none' ? 'block' : 'none';
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
        timestamp: new Date().toISOString()
    };
    try {
        await supabaseFetch('tournaments', 'POST', tournament);
        alert('Турнир создан!');
        createTournamentForm.classList.add('form-hidden');
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
                const tournamentDiv = document.createElement('div');
                tournamentDiv.classList.add('tournament');
                tournamentDiv.innerHTML = `
                    Турнир: ${tournament.name}<br>
                    Дата: ${tournament.date}<br>
                    Логотип: ${tournament.logo}<br>
                    Описание: ${tournament.desc}<br>
                    Адрес: ${tournament.address}<br>
                    Дедлайн: ${tournament.deadline}<br>
                    <button onclick="showRegistrationForm('${tournament.id}')">Зарегистрироваться</button>
                `;
                tournamentList.appendChild(tournamentDiv);
            });
        }
    } catch (error) {
        console.error('Error loading tournaments:', error);
        alert('Ошибка загрузки турниров: ' + error.message);
    }
}

function showRegistrationForm(tournamentId) {
    const form = document.createElement('div');
    form.innerHTML = `
        <input id="reg-speaker1" type="text" placeholder="Имя и фамилия 1-го спикера">
        <input id="reg-speaker2" type="text" placeholder="Имя и фамилия 2-го спикера">
        <input id="reg-club" type="text" placeholder="Клуб">
        <input id="reg-city" type="text" placeholder="Город">
        <input id="reg-contacts" type="text" placeholder="Контакты">
        <textarea id="reg-extra" placeholder="Дополнительно (достижения)"></textarea>
        <button onclick="submitRegistration('${tournamentId}')">Отправить</button>
    `;
    tournamentList.appendChild(form);
}

async function submitRegistration(tournamentId) {
    const registration = {
        tournament_id: parseInt(tournamentId),
        speaker1: document.getElementById('reg-speaker1').value,
        speaker2: document.getElementById('reg-speaker2').value,
        club: document.getElementById('reg-club').value,
        city: document.getElementById('reg-city').value,
        contacts: document.getElementById('reg-contacts').value,
        extra: document.getElementById('reg-extra').value,
        timestamp: new Date().toISOString()
    };
    try {
        await supabaseFetch('registrations', 'POST', registration);
        alert('Регистрация отправлена!');
        loadTournaments();
    } catch (error) {
        console.error('Error saving registration:', error);
        alert('Ошибка: ' + error.message);
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


// ======= ТУРНИРЫ =======
async function loadTournaments() {
    try {
        const tournaments = await supabaseFetch('tournaments?order=created_at.desc', 'GET');
        const list = document.getElementById('tournament-list');
        list.innerHTML = '';
        tournaments.forEach(t => {
            const div = document.createElement('div');
            div.className = 'tournament-card';
            div.innerHTML = `
                <img class="tournament-logo" src="${t.logo}">
                <div class="tournament-info">
                    <h2>${t.name}</h2>
                    <div class="date">${t.date}</div>
                </div>
            `;
            div.onclick = () => openTournamentPage(t.id);
            list.appendChild(div);
        });
    } catch (e) {
        alert('Ошибка загрузки турниров: ' + e.message);
    }
}

function openTournamentPage(id) {
    alert("Переход к турниру: " + id); // пока заглушка
}


let currentTournamentId = null;
let currentTournamentOwner = null;

function openTournamentPage(id) {
    document.getElementById('tournaments').classList.remove('active');
    document.getElementById('tournament-page').style.display = 'block';
    currentTournamentId = id;

    loadTournament(id);
    showTournamentTab('posts');
}

async function loadTournament(id) {
    const data = await supabaseFetch(`tournaments?id=eq.${id}`, 'GET');
    const tournament = data[0];
    currentTournamentOwner = tournament.owner;

    const header = document.getElementById('tournament-header');
    header.innerHTML = `
        <h2>${tournament.name}</h2>
        <p>${tournament.date}</p>
        <button onclick="toggleDescription()">Показать описание</button>
        <div id="tournament-description" style="display:none;">${tournament.desc}</div>
    `;

    if (userData.telegramUsername === tournament.owner) {
        document.getElementById('generate-bracket-btn').style.display = 'inline-block';
    }

    loadTournamentPosts();
    loadRegisteredTeams();
}

function toggleDescription() {
    const desc = document.getElementById('tournament-description');
    desc.style.display = desc.style.display === 'none' ? 'block' : 'none';
}

function showTournamentTab(tab) {
    document.querySelectorAll('.tournament-tab').forEach(el => el.style.display = 'none');
    document.getElementById(`tournament-${tab}`).style.display = 'block';

    if (tab === 'register') loadRegisteredTeams();
    if (tab === 'bracket') showBracketGenerator();
}

// ========== Посты турнира ==========
async function loadTournamentPosts() {
    const postsDiv = document.getElementById('tournament-posts');
    postsDiv.innerHTML = '';

    if (userData.telegramUsername === currentTournamentOwner) {
        const form = document.createElement('div');
        form.innerHTML = `
            <textarea id="tournament-post-text" placeholder="Введите пост..."></textarea>
            <button onclick="submitTournamentPost()">Опубликовать</button>
        `;
        postsDiv.appendChild(form);
    }

    const posts = await supabaseFetch(`tournament_posts?tournament_id=eq.\${currentTournamentId}&order=created_at.desc`, 'GET');
    posts.forEach(post => {
        const div = document.createElement('div');
        div.className = 'post';
        div.innerHTML = `<strong>\${post.title}</strong><p>\${post.text}</p>`;
        postsDiv.appendChild(div);
    });
}

async function submitTournamentPost() {
    const text = document.getElementById('tournament-post-text').value.trim();
    if (!text) return alert('Введите текст');
    await supabaseFetch('tournament_posts', 'POST', {
        tournament_id: currentTournamentId,
        title: userData.telegramUsername,
        text
    });
    loadTournamentPosts();
}

// ========== Регистрация ==========
document.getElementById('team-registration-form').onsubmit = async (e) => {
    e.preventDefault();
    const team = {
        tournament_id: currentTournamentId,
        name: document.getElementById('team-name').value.trim(),
        speaker1: document.getElementById('speaker1').value.trim(),
        speaker2: document.getElementById('speaker2').value.trim(),
        university: document.getElementById('university').value.trim(),
        contacts: document.getElementById('contacts').value.trim(),
        extra: document.getElementById('extra').value.trim(),
    };
    await supabaseFetch('registrations', 'POST', team);
    loadRegisteredTeams();
};

async function loadRegisteredTeams() {
    const container = document.getElementById('registered-teams');
    const teams = await supabaseFetch(`registrations?tournament_id=eq.\${currentTournamentId}`, 'GET');
    container.innerHTML = teams.map(t => `
        <div class="registered-team">
            <strong>\${t.name}</strong> — \${t.speaker1} и \${t.speaker2} [\${t.university}]
        </div>
    `).join('');
}

// ========== Генерация сетки ==========
function showBracketGenerator() {
    const container = document.getElementById('tournament-bracket');
    container.innerHTML = `
        <div id="bracket-generator">
            <select id="bracket-format">
                <option value="APF">АПФ</option>
                <option value="BPF">БПФ</option>
            </select>
            <input type="number" id="bracket-rounds" placeholder="Количество раундов" />
            <button onclick="generateBracket()">Создать сетку</button>
        </div>
        <div id="bracket-output"></div>
    `;
}

async function generateBracket() {
    const format = document.getElementById('bracket-format').value;
    const rounds = parseInt(document.getElementById('bracket-rounds').value);
    const teams = await supabaseFetch(`registrations?tournament_id=eq.\${currentTournamentId}`, 'GET');
    const output = document.getElementById('bracket-output');
    if (!rounds || teams.length % (format === 'BPF' ? 4 : 2) !== 0) {
        return alert('Количество команд не соответствует выбранному формату.');
    }

    const shuffled = [...teams].sort(() => Math.random() - 0.5);
    output.innerHTML = '';

    for (let r = 1; r <= rounds; r++) {
        const roundDiv = document.createElement('div');
        roundDiv.className = 'bracket-round';
        roundDiv.innerHTML = `<h3>Раунд \${r}</h3>`;

        const groupSize = format === 'BPF' ? 4 : 2;
        for (let i = 0; i < shuffled.length; i += groupSize) {
            const matchTeams = shuffled.slice(i, i + groupSize).map(t => t.name).join(' vs ');
            const matchDiv = document.createElement('div');
            matchDiv.className = 'bracket-match';
            matchDiv.textContent = matchTeams;
            roundDiv.appendChild(matchDiv);
        }

        output.appendChild(roundDiv);
    }
}
