console.log("Script loaded");

const socket = io();
const game = new Chess();
let board = null;

// Game State
let roomId = null;
let playerColor = 'w';
let gameStarted = false;

// Timers
let timeLimit = 0; 
let whiteTime = 0; 
let blackTime = 0;
let timerInterval = null;

// Media
let localStream = null;
let peerConnection = null;
let isAudioEnabled = true;
let isVideoEnabled = true;

const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// --- DOM ELEMENTS ---
// We use a helper to get elements to ensure they exist
const landingPage = document.getElementById('landing-page');
const gamePage = document.getElementById('game-page');
const statusMsg = document.getElementById('status-msg');
const timerSelf = document.getElementById('timer-self');
const timerOpponent = document.getElementById('timer-opponent');

// --- 1. LANDING PAGE & ROOM LOGIC ---

document.getElementById('btn-create').addEventListener('click', () => {
    console.log("Create button clicked");
    const timeVal = document.getElementById('time-control').value;
    roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    console.log("Emitting create-room:", roomId);
    socket.emit('create-room', roomId, timeVal);
});

document.getElementById('btn-join').addEventListener('click', () => {
    console.log("Join button clicked");
    const code = document.getElementById('join-room-code').value.toUpperCase().trim();
    if(!code) return alert("Please enter a room code");
    roomId = code;
    socket.emit('join-room', roomId);
});

socket.on('room-error', (msg) => {
    console.error("Room Error:", msg);
    alert(msg);
});

// INITIALIZE GAME (The fix involves order of operations)
socket.on('game-init', (data) => {
    console.log("Game Init received:", data);
    
    // 1. Setup Data
    timeLimit = parseInt(data.time);
    playerColor = data.color;

    // 2. Switch UI (MUST happen before initializing board)
    landingPage.classList.add('d-none');
    gamePage.classList.remove('d-none');
    gamePage.classList.add('d-flex');
    
    document.getElementById('display-room-code').innerText = `Room Code: ${roomId}`;
    
    // 3. Setup Board (Now that div is visible)
    setTimeout(() => {
        initBoard();
        window.dispatchEvent(new Event('resize')); // Force resize just in case
    }, 100);

    // 4. Setup Timers
    if (timeLimit > 0) {
        whiteTime = timeLimit * 60;
        blackTime = timeLimit * 60;
        updateTimerDisplay();
    } else {
        timerSelf.innerText = "∞";
        timerOpponent.innerText = "∞";
    }

    // 5. Start Camera
    startLocalVideo();
});

socket.on('user-connected', (userId) => {
    console.log("User connected:", userId);
    statusMsg.innerText = "Friend connected! Game Start.";
    statusMsg.classList.remove('bg-warning');
    statusMsg.classList.add('bg-success');
    gameStarted = true;
    
    initiateCall();
    
    if(timeLimit > 0) startTimer();
});

// --- 2. CHESS LOGIC ---
let selectedSquare = null;

function initBoard() {
    console.log("Initializing Board...");
    const config = {
        draggable: true,
        position: 'start',
        orientation: playerColor === 'w' ? 'white' : 'black',
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd
    };
    
    // Destroy previous instance if exists
    if(board) board.destroy();
    
    board = Chessboard('myBoard', config);
    
    // Tap-to-move listener
    $('#myBoard').off('click').on('click', '.square-55d63', onSquareClick);
}

function onDragStart(source, piece) {
    if (game.game_over() || !gameStarted) return false;
    if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
        (game.turn() === 'b' && piece.search(/^w/) !== -1)) return false;
    if ((game.turn() !== playerColor)) return false;
}

function onDrop(source, target) {
    removeHighlights();
    const move = game.move({
        from: source,
        to: target,
        promotion: 'q'
    });

    if (move === null) return 'snapback';
    handleMoveMade(move);
}

function onSnapEnd() {
    board.position(game.fen());
}

// TAP TO MOVE LOGIC
function onSquareClick() {
    if (!gameStarted || game.game_over() || game.turn() !== playerColor) return;

    const square = $(this).attr('data-square');
    const piece = game.get(square);

    if (piece && piece.color === game.turn()) {
        removeHighlights();
        selectedSquare = square;
        highlightSquare(square, 'highlight-selected');
        
        const moves = game.moves({ square: square, verbose: true });
        moves.forEach(move => highlightSquare(move.to, 'highlight-valid'));
        return;
    }

    if (selectedSquare) {
        const move = game.move({
            from: selectedSquare,
            to: square,
            promotion: 'q'
        });

        removeHighlights();
        selectedSquare = null;

        if (move) {
            board.position(game.fen());
            handleMoveMade(move);
        }
    }
}

function highlightSquare(sq, cssClass) {
    $('#myBoard .square-' + sq).addClass(cssClass);
}

function removeHighlights() {
    $('#myBoard .square-55d63').removeClass('highlight-selected highlight-valid');
}

function handleMoveMade(move) {
    socket.emit('move', { roomId, move });
    if(timeLimit > 0) socket.emit('timer-sync', { roomId, whiteTime, blackTime });
}

socket.on('move', (move) => {
    game.move(move);
    board.position(game.fen());
});

// --- 3. TIMER LOGIC ---
function startTimer() {
    if(timerInterval) clearInterval(timerInterval);
    
    timerInterval = setInterval(() => {
        if (game.game_over()) {
            clearInterval(timerInterval);
            return;
        }

        if (game.turn() === 'w') {
            whiteTime--;
            if(whiteTime <= 0) endGame("Black wins on time!");
        } else {
            blackTime--;
            if(blackTime <= 0) endGame("White wins on time!");
        }
        updateTimerDisplay();
    }, 1000);
}

function updateTimerDisplay() {
    const wMin = Math.floor(whiteTime / 60).toString().padStart(2, '0');
    const wSec = (whiteTime % 60).toString().padStart(2, '0');
    const bMin = Math.floor(blackTime / 60).toString().padStart(2, '0');
    const bSec = (blackTime % 60).toString().padStart(2, '0');

    if (playerColor === 'w') {
        timerSelf.innerText = `${wMin}:${wSec}`;
        timerOpponent.innerText = `${bMin}:${bSec}`;
    } else {
        timerSelf.innerText = `${bMin}:${bSec}`;
        timerOpponent.innerText = `${wMin}:${wSec}`;
    }
    
    // Highlight active timer
    if(game.turn() === 'w') {
        if(playerColor === 'w') { timerSelf.classList.add('timer-active'); timerOpponent.classList.remove('timer-active'); }
        else { timerOpponent.classList.add('timer-active'); timerSelf.classList.remove('timer-active'); }
    } else {
        if(playerColor === 'b') { timerSelf.classList.add('timer-active'); timerOpponent.classList.remove('timer-active'); }
        else { timerOpponent.classList.add('timer-active'); timerSelf.classList.remove('timer-active'); }
    }
}

socket.on('timer-update', (data) => {
    whiteTime = data.whiteTime;
    blackTime = data.blackTime;
    updateTimerDisplay();
});

function endGame(msg) {
    clearInterval(timerInterval);
    alert(msg);
    gameStarted = false;
}

// --- 4. VIDEO LOGIC ---
async function startLocalVideo() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('local-video').srcObject = localStream;
        console.log("Local video started");
    } catch (err) {
        console.error("Camera Error:", err);
        alert("Could not access camera. Ensure you are on HTTPS or localhost.");
    }
}

function initiateCall() {
    console.log("Initiating WebRTC call");
    peerConnection = new RTCPeerConnection(rtcConfig);
    if(localStream) {
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }

    peerConnection.ontrack = (event) => {
        console.log("Remote stream received");
        document.getElementById('remote-video').srcObject = event.streams[0];
        document.getElementById('video-placeholder').style.display = 'none';
    };
    
    peerConnection.onicecandidate = (event) => {
        if(event.candidate) socket.emit('signal', { roomId, signal: { candidate: event.candidate } });
    };

    peerConnection.createOffer().then(offer => {
        peerConnection.setLocalDescription(offer);
        socket.emit('signal', { roomId, signal: { type: 'offer', sdp: offer } });
    });
}

socket.on('signal', async (signal) => {
    if(!peerConnection) {
        peerConnection = new RTCPeerConnection(rtcConfig);
        if(localStream) {
            localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        }
        peerConnection.ontrack = (event) => {
            document.getElementById('remote-video').srcObject = event.streams[0];
            document.getElementById('video-placeholder').style.display = 'none';
        };
        peerConnection.onicecandidate = (event) => {
            if(event.candidate) socket.emit('signal', { roomId, signal: { candidate: event.candidate } });
        };
    }

    if (signal.type === 'offer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('signal', { roomId, signal: { type: 'answer', sdp: answer } });
    } else if (signal.type === 'answer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    } else if (signal.candidate) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
    }
});

// Controls
document.getElementById('btn-toggle-mic').addEventListener('click', function() {
    isAudioEnabled = !isAudioEnabled;
    if(localStream) localStream.getAudioTracks()[0].enabled = isAudioEnabled;
    this.innerHTML = isAudioEnabled ? '<i class="fa fa-microphone"></i>' : '<i class="fa fa-microphone-slash text-danger"></i>';
});

document.getElementById('btn-toggle-video').addEventListener('click', function() {
    isVideoEnabled = !isVideoEnabled;
    if(localStream) localStream.getVideoTracks()[0].enabled = isVideoEnabled;
    this.innerHTML = isVideoEnabled ? '<i class="fa fa-video"></i>' : '<i class="fa fa-video-slash text-danger"></i>';
});

document.getElementById('btn-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(roomId);
    alert("Copied: " + roomId);
});
