const socket = io();
const game = new Chess();
let board = null;
let playerColor = 'w'; // Default white
let roomId = null;

// --- 1. Room Logic ---
// Get Room ID from URL or create one
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('room')) {
    roomId = urlParams.get('room');
} else {
    roomId = Math.random().toString(36).substring(7);
    window.history.pushState({}, '', `?room=${roomId}`);
}
document.getElementById('room-id-display').innerText = `Room: ${roomId}`;

// Join the room
socket.emit('join-room', roomId, socket.id);

socket.on('full-room', () => {
    alert("This room is full!");
    window.location.href = '/';
});

socket.on('player-color', (color) => {
    playerColor = color;
    initBoard();
    startLocalVideo(); // Start camera when joined
});

// --- 2. Chess Logic ---
function initBoard() {
    const config = {
        draggable: true,
        position: 'start',
        orientation: playerColor === 'w' ? 'white' : 'black',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd
    };
    board = Chessboard('myBoard', config);
}

function onDragStart(source, piece) {
    // Only pick up own pieces and if game isn't over
    if (game.game_over()) return false;
    if ((playerColor === 'w' && piece.search(/^b/) !== -1) ||
        (playerColor === 'b' && piece.search(/^w/) !== -1)) {
        return false;
    }
}

function onDrop(source, target) {
    const move = game.move({
        from: source,
        to: target,
        promotion: 'q' // NOTE: Always promote to a queen for simplicity
    });

    if (move === null) return 'snapback';

    // Send move to server
    socket.emit('move', { roomId, move });
}

function onSnapEnd() {
    board.position(game.fen());
}

socket.on('move', (move) => {
    game.move(move);
    board.position(game.fen());
});

// Resizing handling for mobile
window.addEventListener('resize', () => {
    if(board) board.resize();
});

// Copy Link Button
document.getElementById('copy-link').addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href);
    alert('Link copied! Send it to your friend.');
});

// --- 3. Video Chat (WebRTC) ---
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const statusText = document.getElementById('status');
let localStream;
let peerConnection;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' } // Free Google STUN server
    ]
};

async function startLocalVideo() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
    } catch (err) {
        console.error("Error accessing media devices.", err);
        alert("Camera access denied or not found.");
    }
}

// When a second user joins, the server tells the first user
socket.on('user-connected', async () => {
    statusText.innerText = "Connecting...";
    createPeerConnection();
    
    // Create an offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    socket.emit('signal', { roomId, signal: { type: 'offer', sdp: offer } });
});

// Handle signaling data (offer/answer/ice)
socket.on('signal', async (signal) => {
    if (!peerConnection) createPeerConnection();

    if (signal.type === 'offer') {
        statusText.innerText = "Connecting...";
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('signal', { roomId, signal: { type: 'answer', sdp: answer } });
    } 
    else if (signal.type === 'answer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    } 
    else if (signal.candidate) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch (e) { console.error('Error adding received ice candidate', e); }
    }
});

function createPeerConnection() {
    if (peerConnection) return;

    peerConnection = new RTCPeerConnection(rtcConfig);

    // Add local stream tracks to connection
    if (localStream) {
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }

    // Handle remote stream
    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
        statusText.style.display = 'none'; // Hide waiting text
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { roomId, signal: { candidate: event.candidate } });
        }
    };
}