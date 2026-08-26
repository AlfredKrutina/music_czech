class MultiplayerNetwork {
    constructor() {
        this.peer = null;
        this.isHost = false;
        this.connections = new Map(); // For Host: peerId -> { conn, name, score, skipVote }
        this.hostConnection = null;   // For Guest: connection to Host
        
        this.roomId = null;
        this.myId = null;
        this.myName = '';
        
        this.listeners = {};
    }

    on(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    }

    emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => cb(data));
        }
    }

    async createRoom(playerName) {
        this.isHost = true;
        this.myName = playerName;
        this.roomId = this._generateRoomCode();
        this.myId = `mg_${this.roomId}_host`;
        
        return new Promise((resolve, reject) => {
            this.peer = new Peer(this.myId);

            this.peer.on('open', (id) => {
                // Host is also a player
                this.connections.set(this.myId, {
                    conn: null,
                    name: playerName,
                    score: 0,
                    skipVote: false,
                    status: 'waiting'
                });
                this.emit('connected', { roomId: this.roomId, isHost: true });
                resolve(this.roomId);
            });

            this.peer.on('connection', (conn) => {
                this._setupHostConnection(conn);
            });

            this.peer.on('error', (err) => {
                reject(err);
            });
        });
    }

    async joinRoom(roomId, playerName) {
        this.isHost = false;
        this.myName = playerName;
        this.roomId = roomId.toUpperCase();
        this.hostId = `mg_${this.roomId}_host`;
        
        return new Promise((resolve, reject) => {
            this.peer = new Peer();
            
            this.peer.on('open', (id) => {
                this.myId = id;
                const conn = this.peer.connect(this.hostId, {
                    metadata: { name: playerName },
                    reliable: true
                });
                
                const timeoutId = setTimeout(() => {
                    reject(new Error("Connection timed out. The host may have left or the room code is invalid."));
                    if (conn) conn.close();
                }, 7000);

                conn.on('open', () => {
                    clearTimeout(timeoutId);
                    this.hostConnection = conn;
                    this._setupGuestConnection(conn);
                    this.emit('connected', { roomId: this.roomId, isHost: false });
                    resolve(this.roomId);
                });
                
                conn.on('error', (err) => {
                    clearTimeout(timeoutId);
                    reject(err);
                });
            });
            
            this.peer.on('error', (err) => reject(err));
        });
    }

    _setupHostConnection(conn) {
        conn.on('open', () => {
            const peerId = conn.peer;
            const name = conn.metadata?.name || 'Unknown';
            this.connections.set(peerId, {
                conn: conn,
                name: name,
                score: 0,
                skipVote: false,
                status: 'waiting'
            });
            this.emit('playerJoined', { id: peerId, name: name });
            this._broadcastPlayerList();
        });
        
        conn.on('data', (data) => {
            this.emit('message', { from: conn.peer, ...data });
        });
        
        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this.emit('playerLeft', { id: conn.peer });
            this._broadcastPlayerList();
        });
    }

    _setupGuestConnection(conn) {
        conn.on('data', (data) => {
            this.emit('message', data);
        });
        
        conn.on('close', () => {
            this.emit('disconnected');
        });
    }

    broadcast(type, payload) {
        if (!this.isHost) return;
        const msg = { type, payload };
        this.connections.forEach((peerData, peerId) => {
            if (peerId !== this.myId && peerData.conn && peerData.conn.open) {
                peerData.conn.send(msg);
            }
        });
        
        // Host also receives its own broadcasts locally
        this.emit('message', { from: this.myId, type, payload });
    }

    sendToHost(type, payload) {
        if (this.isHost) {
            this.emit('message', { from: this.myId, type, payload });
        } else if (this.hostConnection && this.hostConnection.open) {
            this.hostConnection.send({ type, payload });
        }
    }
    
    sendToPeer(peerId, type, payload) {
        if (!this.isHost || peerId === this.myId) return;
        const peer = this.connections.get(peerId);
        if (peer && peer.conn && peer.conn.open) {
            peer.conn.send({ type, payload });
        }
    }
    
    addScore(peerId, points) {
        if (!this.isHost) return;
        const peer = this.connections.get(peerId);
        if (peer) {
            peer.score += points;
            this._broadcastPlayerList();
        }
    }

    _broadcastPlayerList() {
        if (!this.isHost) return;
        const players = [];
        this.connections.forEach((data, id) => {
            players.push({ id, name: data.name, score: data.score, skipVote: data.skipVote, status: data.status });
        });
        this.broadcast('UPDATE_PLAYERS', { players });
    }

    _generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i=0; i<6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
        return code;
    }
}

window.MP = new MultiplayerNetwork();
