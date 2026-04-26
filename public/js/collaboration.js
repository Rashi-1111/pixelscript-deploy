class CollaborationCanvas {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.isDrawing = false;
        this.currentColor = '#000000';
        this.currentSize = 2;
        this.currentTool = 'brush';
        this.drawHistory = [];
        this.redoHistory = [];
        this.socket = io(window.location.origin);
        this.room = window.location.pathname.split('/').pop().replace('.html', '');
        
        this.initializeCanvas();
        this.setupEventListeners();
        this.setupSocketEvents();

        // Join collaboration room
        this.socket.emit('joinRoom', { room: this.room, userType: 'artist' });
    }

    initializeCanvas() {
        // Set canvas size to match container
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        // Set default styles
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
    }

    resizeCanvas() {
        const container = this.canvas.parentElement;
        this.canvas.width = container.offsetWidth;
        this.canvas.height = container.offsetHeight;
    }

    setupEventListeners() {
        this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', () => this.stopDrawing());
        this.canvas.addEventListener('mouseout', () => this.stopDrawing());

        // Touch events
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            this.startDrawing(touch);
        });

        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            this.draw(touch);
        });

        this.canvas.addEventListener('touchend', () => this.stopDrawing());
    }

    setupSocketEvents() {
        this.socket.on('draw', (data) => {
            if (data.room === this.room) {
                this.drawFromSocket(data);
            }
        });

        this.socket.on('clear', (data) => {
            if (data.room === this.room) {
                this.clearCanvas(false);
            }
        });

        this.socket.on('undo', (data) => {
            if (data.room === this.room) {
                this.undoLastAction(false);
            }
        });

        this.socket.on('redo', (data) => {
            if (data.room === this.room) {
                this.redoLastAction(false);
            }
        });

        this.socket.on('chatMessage', (data) => {
            if (data.room === this.room && data.sender !== this.socket.id) {
                const chatMessages = document.querySelector('.chat-messages');
                const messageHtml = `
                    <div class="message received">
                        <img src="../images/user-1.png" alt="${data.sender}" class="message-avatar">
                        <div class="message-content">
                            <span class="message-sender">${data.sender}</span>
                            <p>${data.message}</p>
                        </div>
                    </div>
                `;
                chatMessages.insertAdjacentHTML('beforeend', messageHtml);
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
        });
    }

    startDrawing(e) {
        this.isDrawing = true;
        const pos = this.getPosition(e);
        this.ctx.beginPath();
        this.ctx.moveTo(pos.x, pos.y);
        this.saveState();
    }

    draw(e) {
        if (!this.isDrawing) return;

        const pos = this.getPosition(e);
        
        switch (this.currentTool) {
            case 'brush':
                this.ctx.lineTo(pos.x, pos.y);
                this.ctx.strokeStyle = this.currentColor;
                this.ctx.lineWidth = this.currentSize;
                this.ctx.stroke();
                break;
            case 'eraser':
                this.ctx.lineTo(pos.x, pos.y);
                this.ctx.strokeStyle = '#ffffff';
                this.ctx.lineWidth = this.currentSize * 2;
                this.ctx.stroke();
                break;
        }

        // Emit drawing data to other users
        this.socket.emit('draw', {
            x: pos.x,
            y: pos.y,
            color: this.currentColor,
            size: this.currentSize,
            tool: this.currentTool,
            room: this.room
        });
    }

    stopDrawing() {
        this.isDrawing = false;
        this.ctx.closePath();
    }

    getPosition(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    drawFromSocket(data) {
        this.ctx.beginPath();
        this.ctx.lineTo(data.x, data.y);
        this.ctx.strokeStyle = data.tool === 'eraser' ? '#ffffff' : data.color;
        this.ctx.lineWidth = data.tool === 'eraser' ? data.size * 2 : data.size;
        this.ctx.stroke();
        this.ctx.closePath();
    }

    setColor(color) {
        this.currentColor = color;
    }

    setSize(size) {
        this.currentSize = size;
    }

    setTool(tool) {
        this.currentTool = tool;
    }

    clearCanvas(emit = true) {
        this.saveState();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (emit) {
            this.socket.emit('clear', { room: this.room });
        }
    }

    saveState() {
        this.drawHistory.push(this.canvas.toDataURL());
        this.redoHistory = []; // Clear redo history when new action is taken
    }

    undoLastAction(emit = true) {
        if (this.drawHistory.length > 0) {
            const lastState = this.drawHistory.pop();
            this.redoHistory.push(this.canvas.toDataURL());
            
            const img = new Image();
            img.src = lastState;
            img.onload = () => {
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.drawImage(img, 0, 0);
            };

            if (emit) {
                this.socket.emit('undo', { room: this.room });
            }
        }
    }

    redoLastAction(emit = true) {
        if (this.redoHistory.length > 0) {
            const nextState = this.redoHistory.pop();
            this.drawHistory.push(this.canvas.toDataURL());
            
            const img = new Image();
            img.src = nextState;
            img.onload = () => {
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.drawImage(img, 0, 0);
            };

            if (emit) {
                this.socket.emit('redo', { room: this.room });
            }
        }
    }
}
