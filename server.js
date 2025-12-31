const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Public klasörünü aç
app.use(express.static(__dirname + '/public'));

// Soruları al
const questions = require('./questions.json');

// Oyun Değişkenleri
let players = []; 
let currentQuestionIndex = 0;
let currentAnswers = {}; 
let questionStartTime = 0;
let isQuestionActive = false;
let autoTransitionTimer = null;

// Soru Süresi Bitince Çalışan Fonksiyon
function finishQuestion() {
    if (!isQuestionActive) return;
    
    isQuestionActive = false;
    clearTimeout(autoTransitionTimer); // Sayacı temizle

    const correctIndex = questions[currentQuestionIndex].answer;
    
    // Puanlama Sistemi
    players.forEach(p => {
        const data = currentAnswers[p.id];
        if (data && data.index === correctIndex) {
            // Taban Puan (500) + Hız Bonusu (Max 500)
            // Ne kadar hızlıysa o kadar çok puan
            let speedBonus = Math.max(0, 500 - (data.time * 20));
            p.score += (500 + Math.floor(speedBonus));
        }
    });

    // Herkese sonuçları gönder
    io.emit('show-results', { correctIndex: correctIndex });
}

io.on('connection', (socket) => {
    
    // --- OYUNCU GİRİŞİ ---
    socket.on('player-join', (username) => {
        const cleanName = username.trim();
        
        // Giriş Kontrolleri
        if (cleanName.length < 3 || cleanName.length > 16) {
            socket.emit('error-msg', 'İsim 3-16 karakter olmalı!');
            return;
        }
        if(players.find(p => p.name === cleanName)) {
            socket.emit('error-msg', 'Bu isim zaten alınmış!');
            return;
        }

        players.push({ id: socket.id, name: cleanName, score: 0 });
        io.emit('update-player-count', players.length);
        socket.emit('wait-screen');
    });

    // --- CEVAP ALMA ---
    socket.on('submit-answer', (answerIndex) => {
        if (!isQuestionActive) return; // Süre bittiyse cevap alma
        if (currentAnswers[socket.id] !== undefined) return; // Zaten cevapladıysa alma

        const timeTaken = (Date.now() - questionStartTime) / 1000;
        currentAnswers[socket.id] = { index: answerIndex, time: timeTaken };
        
        // Admin ekranındaki sayacı güncelle
        io.emit('update-answer-count', { answered: Object.keys(currentAnswers).length, total: players.length });
    });

    // --- ADMIN YÖNETİMİ ---
    socket.on('admin-start-question', () => {
        clearTimeout(autoTransitionTimer);
        currentAnswers = {}; 
        const q = questions[currentQuestionIndex];
        questionStartTime = Date.now();
        isQuestionActive = true;

        // --- RASTGELE KAOS MODU SEÇİCİ ---
        const rand = Math.random(); 
        let selectedMode = q.mode || 'normal';

        // Eğer sorunun modu "normal" ise, %30 ihtimalle bir olay tetikle
        if (selectedMode === 'normal') {
            if (rand < 0.05) selectedMode = 'flashlight';       // 🔦 Karanlık (%5)
            else if (rand < 0.10) selectedMode = 'mirror';      // 🪞 Ayna (%5)
            else if (rand < 0.15) selectedMode = 'earthquake';  // 🌋 Deprem (%5)
            else if (rand < 0.20) selectedMode = 'upside-down'; // 🙃 Ters (%5)
            else if (rand < 0.25) selectedMode = 'glitch';      // 👾 Glitch (%5)
            else if (rand < 0.30) selectedMode = 'spin';        // 🌀 Dönme (%5)
            // Kalan %70 ihtimalle NORMAL devam eder.
        }

        const questionDuration = q.time || 20;

        // Soruyu ve Modu Gönder
        io.emit('new-question', { 
            question: q.question, 
            options: q.options,
            mode: selectedMode,
            time: questionDuration,
            totalQuestions: questions.length,
            currentStep: currentQuestionIndex + 1
        });

        // Sunucu taraflı otomatik bitirme sayacı (Client ile senkron olması için +1 sn tolerans)
        autoTransitionTimer = setTimeout(() => {
            finishQuestion();
        }, (questionDuration + 1) * 1000);
    });

    // Admin manuel bitirmek isterse
    socket.on('admin-show-results', () => { finishQuestion(); });

    socket.on('admin-show-leaderboard', () => {
        // Puan sıralaması (Büyükten küçüğe)
        const sorted = [...players].sort((a, b) => b.score - a.score);
        io.emit('show-leaderboard', sorted.slice(0, 5));
    });

    socket.on('admin-next-step', () => {
        currentQuestionIndex++;
        if (currentQuestionIndex < questions.length) {
            io.emit('trigger-next-question'); 
        } else {
            // Oyun Bitti
            const sorted = [...players].sort((a, b) => b.score - a.score);
            io.emit('game-over', sorted);
            
            // Sıfırla
            currentQuestionIndex = 0;
            players = [];
            currentAnswers = {};
        }
    });

    socket.on('disconnect', () => {
        players = players.filter(p => p.id !== socket.id);
        io.emit('update-player-count', players.length);
    });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu çalışıyor: Port ${PORT}`);
});
