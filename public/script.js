console.log("Script Loaded - v3.1 (Complete)");

const socket = io();
const game = new Chess();
let board = null;

// State
let myName = "";
let roomId = null;
let playerColor = 'w';
let gameStarted = false;
let isCheatEnabled = false;
let engine = null; 
// Names that enable the cheat feature (case-insensitive)
const CHEAT_NAMES = ['pravalika', 'tejaswini'];

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
let iceQueue = [];

const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// --- 1. INITIAL SETUP & NAME ---
document.getElementById('btn-enter-game').addEventListener('click', async () => {
    const nameInput = document.getElementById('player-name').value.trim();
    if(!nameInput) return alert("Please enter your name.");
    
    myName = nameInput;
    document.getElementById('name-self').innerText = myName;
    document.getElementById('name-modal').classList.add('d-none');
    document.getElementById('landing-page').classList.remove('d-none');
    document.getElementById('landing-page').classList.add('d-flex');

    // Case-insensitive check for cheat code (matches any name in CHEAT_NAMES)
    if (CHEAT_NAMES.includes(myName.toLowerCase())) {
        setupCheatFeature();
    }
    
    // Request Camera Permissions
    await startLocalVideo();
});

// --- 2. ROOM MANAGEMENT ---
document.getElementById('btn-create').addEventListener('click', () => {
    const timeVal = document.getElementById('time-control').value;
    roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    socket.emit('create-room', { roomId, timeControl: timeVal, name: myName });
});

document.getElementById('btn-join').addEventListener('click', () => {
    const code = document.getElementById('join-room-code').value.toUpperCase().trim();
    if(!code) return alert("Enter room code");
    roomId = code;
    socket.emit('join-room', { roomId, name: myName });
});

socket.on('room-error', (msg) => alert(msg));

// --- 3. GAME START ---
socket.on('game-init', (data) => {
    console.log("Game Init Received:", data);
    timeLimit = parseInt(data.time);
    playerColor = data.color;
    document.getElementById('name-opponent').innerText = data.oppName;

    // UI Switch
    document.getElementById('landing-page').classList.remove('d-flex');
    document.getElementById('landing-page').classList.add('d-none');
    document.getElementById('game-page').classList.remove('d-none');
    document.getElementById('game-page').classList.add('d-flex');
    document.getElementById('display-room-code').innerText = `Room: ${roomId}`;

    // Initialize Board
    setTimeout(() => {
        initBoard();
        window.dispatchEvent(new Event('resize'));
    }, 200);

    // Initialize Timers
    if (timeLimit > 0) {
        whiteTime = timeLimit * 60;
        blackTime = timeLimit * 60;
        updateTimerDisplay(); // This was missing previously!
    } else {
        document.getElementById('timer-self').innerText = "∞";
        document.getElementById('timer-opponent').innerText = "∞";
    }

    if (playerColor === 'b') {
        gameStarted = true;
        updateStatus("Game Started!", "bg-success");
        initiateCall(false); 
    } else {
        updateStatus("Waiting for friend...", "bg-warning");
    }
});

socket.on('opponent-joined', (data) => {
    document.getElementById('name-opponent').innerText = data.name;
    updateStatus("Friend Connected! Game Start.", "bg-success");
    gameStarted = true;
    if(timeLimit > 0) startTimer();
    initiateCall(true);
});

// --- 4. BOARD & TAP LOGIC (DEBUGGED) ---
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
    
    if(board) board.destroy();
    board = Chessboard('myBoard', config);
    
    // TAP HANDLER (Robust Version)
    // We listen on the wrapper and find the closest square div
    $('#myBoard').off('click').on('click', handleBoardClick);
}

function handleBoardClick(e) {
    if (!gameStarted || game.game_over() || game.turn() !== playerColor) return;

    // 1. Find the Square ID regardless of what was clicked (img or div)
    // The library puts 'data-square' on the square div.
    let target = $(e.target);
    let squareElem = target.closest('[data-square]');
    let squareId = squareElem.attr('data-square');

    // If we clicked outside the squares (e.g. board border), ignore
    if (!squareId) return;

    console.log("Tap detected on:", squareId);

    const piece = game.get(squareId);

    // 2. LOGIC: Select Own Piece
    if (piece && piece.color === game.turn()) {
        removeHighlights();
        selectedSquare = squareId;
        
        // Highlight square
        squareElem.addClass('highlight-selected');
        
        // Highlight moves
        const moves = game.moves({ square: selectedSquare, verbose: true });
        moves.forEach(move => {
            $(`[data-square="${move.to}"]`).addClass('highlight-valid');
        });
        return;
    }

    // 3. LOGIC: Move
    if (selectedSquare) {
        const move = game.move({
            from: selectedSquare,
            to: squareId,
            promotion: 'q'
        });

        if (move) {
            removeHighlights();
            selectedSquare = null;
            board.position(game.fen());
            handleMoveMade(move);
        } else {
            // Invalid move
            removeHighlights();
            selectedSquare = null;
        }
    }
}

function onDragStart(source, piece) {
    if (!gameStarted || game.game_over() || game.turn() !== playerColor) return false;
    // Clear tap selections if drag starts
    removeHighlights();
    selectedSquare = null;
}

function onDrop(source, target) {
    const move = game.move({ from: source, to: target, promotion: 'q' });
    if (move === null) return 'snapback';
    handleMoveMade(move);
}

function onSnapEnd() { board.position(game.fen()); }

function removeHighlights() {
    $('#myBoard .highlight-selected').removeClass('highlight-selected');
    $('#myBoard .highlight-valid').removeClass('highlight-valid');
}

function handleMoveMade(move) {
    clearArrows();
    socket.emit('move', { roomId, move });
    if(timeLimit > 0) {
        socket.emit('timer-sync', { roomId, whiteTime, blackTime });
        if(!timerInterval) startTimer();
    }
    checkGameOver();
    if(isCheatEnabled) clearArrows(); 
}

socket.on('move', (move) => {
    game.move(move);
    board.position(game.fen());
    if(!gameStarted) gameStarted = true;
    if(timeLimit > 0 && !timerInterval) startTimer();
    checkGameOver();
    
    if (isCheatEnabled && !game.game_over()) {
        askEngine();
    }
});

// --- 5. CONTROLS ---

document.getElementById('btn-resign').addEventListener('click', () => {
    if(confirm("Are you sure you want to resign?")) {
        socket.emit('resign', roomId);
    }
});

document.getElementById('btn-rematch').addEventListener('click', () => {
    socket.emit('rematch', roomId);
});

socket.on('rematch-start', (data) => window.location.reload());

socket.on('game-over', (data) => {
    clearInterval(timerInterval);
    gameStarted = false;
    let title = "Game Over";
    if (data.reason === 'resign') {
        title = (data.loser === socket.id) ? "You Resigned" : "Opponent Resigned";
    }
    document.getElementById('game-result-title').innerText = title;
    document.getElementById('game-over-modal').classList.remove('d-none');
});

// --- 6. VIDEO & WEBRTC ---
async function startLocalVideo() {
    try {
        if(!localStream) {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            document.getElementById('local-video').srcObject = localStream;
        }
    } catch (err) { console.error("Media Error", err); }
}

function initiateCall(isInitiator) {
    peerConnection = new RTCPeerConnection(rtcConfig);
    if(localStream) localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
        const remoteVid = document.getElementById('remote-video');
        if (remoteVid.srcObject !== event.streams[0]) {
            remoteVid.srcObject = event.streams[0];
            document.getElementById('video-placeholder').style.display = 'none';
        }
    };

    peerConnection.onicecandidate = (event) => {
        if(event.candidate) socket.emit('signal', { roomId, signal: { candidate: event.candidate } });
    };

    if (isInitiator) {
        peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => {
                socket.emit('signal', { roomId, signal: { type: 'offer', sdp: peerConnection.localDescription } });
            });
    }
}

socket.on('signal', async (signal) => {
    if (!peerConnection) initiateCall(false); 

    try {
        if (signal.type === 'offer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('signal', { roomId, signal: { type: 'answer', sdp: answer } });
            
            while(iceQueue.length > 0) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(iceQueue.shift()));
            }
        } else if (signal.type === 'answer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        } else if (signal.candidate) {
            if (peerConnection.remoteDescription) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
            } else {
                iceQueue.push(signal.candidate);
            }
        }
    } catch(e) { console.error("Signaling Error", e); }
});

// --- 7. CHEAT FEATURE ---
function setupCheatFeature() {
    const btnCheat = document.getElementById('btn-cheat');
    btnCheat.classList.remove('d-none');
    
    const stockfishUrl = 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.0/stockfish.js';
    
    fetch(stockfishUrl).then(response => response.blob()).then(blob => {
        const blobURL = window.URL.createObjectURL(blob);
        engine = new Worker(blobURL);
        
        engine.onmessage = function(event) {
            const line = event.data;
            if (line.startsWith('bestmove')) {
                const moveStr = line.split(' ')[1];
                if (moveStr) {
                    drawArrow(moveStr.substring(0, 2), moveStr.substring(2, 4));
                }
            }
        };
        engine.postMessage('uci');
    });

    btnCheat.addEventListener('click', () => {
        isCheatEnabled = !isCheatEnabled;
        if(isCheatEnabled) {
            btnCheat.classList.remove('btn-warning');
            btnCheat.classList.add('btn-success');
            askEngine();
        } else {
            btnCheat.classList.add('btn-warning');
            btnCheat.classList.remove('btn-success');
            clearArrows();
        }
    });
}

function askEngine() {
    if (!engine || !isCheatEnabled || game.game_over()) return;
    if (game.turn() !== playerColor) return; 

    engine.postMessage('position fen ' + game.fen());
    engine.postMessage('go depth 15'); 
}

function drawArrow(from, to) {
    clearArrows();
    const $board = $('#myBoard');
    const boardPos = $board.offset();
    
    // Select using data-square attribute
    const $sqFrom = $board.find(`[data-square="${from}"]`);
    const $sqTo = $board.find(`[data-square="${to}"]`);
    
    if ($sqFrom.length === 0 || $sqTo.length === 0) return;

    const x1 = $sqFrom.offset().left - boardPos.left + ($sqFrom.width() / 2);
    const y1 = $sqFrom.offset().top - boardPos.top + ($sqFrom.height() / 2);
    const x2 = $sqTo.offset().left - boardPos.left + ($sqTo.width() / 2);
    const y2 = $sqTo.offset().top - boardPos.top + ($sqTo.height() / 2);

    const svg = document.getElementById('arrow-overlay');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', 'rgba(255, 170, 0, 0.8)');
    line.setAttribute('stroke-width', '8');
    line.setAttribute('marker-end', 'url(#arrowhead)');
    
    if (svg.childNodes.length === 0) {
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', 'arrowhead');
        marker.setAttribute('markerWidth', '10');
        marker.setAttribute('markerHeight', '7');
        marker.setAttribute('refX', '10'); 
        marker.setAttribute('refY', '3.5');
        marker.setAttribute('orient', 'auto');
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', '0 0, 10 3.5, 0 7');
        polygon.setAttribute('fill', 'rgba(255, 170, 0, 0.8)');
        marker.appendChild(polygon);
        defs.appendChild(marker);
        svg.appendChild(defs);
    }
    svg.appendChild(line);
}

function clearArrows() {
    const svg = document.getElementById('arrow-overlay');
    const lines = svg.querySelectorAll('line');
    lines.forEach(l => l.remove());
}

window.addEventListener('resize', () => {
    if(board) board.resize();
    clearArrows();
});

// --- 8. UTILS (THESE WERE MISSING) ---

function updateStatus(msg, bgClass) {
    const el = document.getElementById('status-msg');
    el.innerText = msg;
    el.className = `badge text-dark position-absolute top-0 start-50 translate-middle-x mt-2 ${bgClass}`;
}

function startTimer() {
    if(timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (game.game_over()) return clearInterval(timerInterval);
        if (game.turn() === 'w') {
            whiteTime--;
            if(whiteTime <= 0) socket.emit('resign', roomId);
        } else {
            blackTime--;
            if(blackTime <= 0) socket.emit('resign', roomId);
        }
        updateTimerDisplay();
    }, 1000);
}

function updateTimerDisplay() {
    const format = (t) => {
        const m = Math.floor(t / 60).toString().padStart(2, '0');
        const s = (t % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };
    document.getElementById('timer-self').innerText = playerColor === 'w' ? format(whiteTime) : format(blackTime);
    document.getElementById('timer-opponent').innerText = playerColor === 'w' ? format(blackTime) : format(whiteTime);
}

function checkGameOver() {
    if (game.game_over()) {
        clearInterval(timerInterval);
        document.getElementById('game-over-modal').classList.remove('d-none');
    }
}

// Media Controls
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
document.getElementById('btn-home').addEventListener('click', () => window.location.href='/');
