const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const parties = new Map();

const sessions = new Map();

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
};

function send(ws, data) {

    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {

        ws.send(
            JSON.stringify(data)
        );

    }

}

function makeCode() {

    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code;

    do {

        code = "";

        for (let i = 0; i < 5; i++) {

            code += chars[
                Math.floor(
                    Math.random() *
                    chars.length
                )
            ];

        }

    } while (parties.has(code));

    return code;
}

function makeToken() {

    return crypto
        .randomBytes(24)
        .toString("hex");
}

function lobbyData(party) {

    return {
        type: "lobby",
        host: party.host,
        players: [...party.players.values()]
            .map(p => ({
                id: p.id,
                name: p.name,
                host: p.id === party.host
            }))
    };

}

function broadcastLobby(party) {

    const data = lobbyData(party);

    for (
        const player
        of party.players.values()
    ) {

        send(
            player.ws,
            data
        );

    }

}

function broadcastPlayers(party) {

    const players = [
        ...party.players.values()
    ].map(p => ({
        id: p.id,
        name: p.name,
        x: p.x || 0,
        y: p.y || 1.6,
        z: p.z || 0
    }));

    for (
        const player
        of party.players.values()
    ) {

        send(
            player.ws,
            {
                type: "players",
                players
            }
        );

    }

}

function removePlayer(player) {

    if (!player)
        return;

    const party =
        parties.get(
            player.party
        );

    if (!party)
        return;

    party.players.delete(
        player.id
    );

    sessions.delete(
        player.id
    );

    if (
        party.host === player.id
    ) {

        const next =
            party.players.values().next();

        if (!next.done) {

            party.host =
                next.value.id;

        }

    }

    if (
        party.players.size === 0
    ) {

        parties.delete(
            player.party
        );

        return;

    }

    broadcastLobby(party);
    broadcastPlayers(party);
}

/* --------------------------------------------------
   HTTP SERVER
-------------------------------------------------- */

const server = http.createServer(
    (req, res) => {

        let requestPath =
            req.url.split("?")[0];

        if (
            requestPath === "/"
        ) {

            requestPath = "/index.html";

        }

        const filePath =
            path.join(
                __dirname,
                requestPath
            );

        if (
            !filePath.startsWith(
                __dirname
            )
        ) {

            res.writeHead(403);
            res.end("Forbidden");
            return;

        }

        fs.readFile(
            filePath,
            (err, data) => {

                if (err) {

                    res.writeHead(404);
                    res.end("Not Found");
                    return;

                }

                const ext =
                    path.extname(
                        filePath
                    );

                res.writeHead(
                    200,
                    {
                        "Content-Type":
                            MIME[ext] ||
                            "application/octet-stream"
                    }
                );

                res.end(data);

            }
        );

    }
);

/* --------------------------------------------------
   WEBSOCKET
-------------------------------------------------- */

const wss =
    new WebSocket.Server({
        server
    });

wss.on(
    "connection",
    ws => {

        let player = null;

        ws.on(
            "message",
            raw => {

                let data;

                try {

                    data =
                        JSON.parse(
                            raw.toString()
                        );

                } catch {

                    send(ws, {
                        type: "error",
                        message: "Invalid message."
                    });

                    return;

                }

                /* ---------------------------
                   CREATE PARTY
                --------------------------- */

                if (
                    data.type ===
                    "createParty"
                ) {

                    const name =
                        String(
                            data.name ||
                            "Player"
                        )
                        .trim()
                        .slice(0, 16);

                    if (!name) {

                        send(ws, {
                            type: "error",
                            message:
                                "Enter your name."
                        });

                        return;

                    }

                    const code =
                        makeCode();

                    const token =
                        makeToken();

                    const newPlayer = {
                        id: token,
                        name,
                        party: code,
                        ws,
                        x: -42,
                        y: 1.6,
                        z: 42
                    };

                    const party = {
                        code,
                        host: token,
                        started: false,
                        keyCollected: false,
                        players: new Map()
                    };

                    party.players.set(
                        token,
                        newPlayer
                    );

                    parties.set(
                        code,
                        party
                    );

                    sessions.set(
                        token,
                        newPlayer
                    );

                    player =
                        newPlayer;

                    send(ws, {
                        type: "session",
                        token
                    });

                    send(ws, {
                        type: "partyCreated",
                        code
                    });

                    broadcastLobby(party);

                    return;
                }

                /* ---------------------------
                   JOIN PARTY
                --------------------------- */

                if (
                    data.type ===
                    "joinParty"
                ) {

                    const code =
                        String(
                            data.code || ""
                        )
                        .trim()
                        .toUpperCase();

                    const name =
                        String(
                            data.name ||
                            "Player"
                        )
                        .trim()
                        .slice(0, 16);

                    const party =
                        parties.get(code);

                    if (!party) {

                        send(ws, {
                            type: "error",
                            message:
                                "Party not found."
                        });

                        return;

                    }

                    if (party.started) {

                        send(ws, {
                            type: "error",
                            message:
                                "The game has already started."
                        });

                        return;

                    }

                    if (
                        party.players.size >= 8
                    ) {

                        send(ws, {
                            type: "error",
                            message:
                                "Party is full."
                        });

                        return;

                    }

                    const token =
                        makeToken();

                    const newPlayer = {
                        id: token,
                        name,
                        party: code,
                        ws,
                        x: -42,
                        y: 1.6,
                        z: 42
                    };

                    party.players.set(
                        token,
                        newPlayer
                    );

                    sessions.set(
                        token,
                        newPlayer
                    );

                    player =
                        newPlayer;

                    send(ws, {
                        type: "session",
                        token
                    });

                    send(ws, {
                        type: "partyJoined",
                        code
                    });

                    broadcastLobby(party);

                    return;
                }

                /* ---------------------------
                   RECONNECT
                --------------------------- */

                if (
                    data.type ===
                    "reconnect"
                ) {

                    const token =
                        String(
                            data.token || ""
                        );

                    const code =
                        String(
                            data.code || ""
                        )
                        .toUpperCase();

                    const existing =
                        sessions.get(token);

                    const party =
                        parties.get(code);

                    if (
                        !existing ||
                        !party ||
                        existing.party !== code
                    ) {

                        send(ws, {
                            type: "error",
                            message:
                                "Your party session expired."
                        });

                        return;

                    }

                    existing.ws =
                        ws;

                    player =
                        existing;

                    send(ws, {
                        type: "session",
                        token
                    });

                    if (party.started) {

                        send(ws, {
                            type: "gameStarted"
                        });

                    } else {

                        send(ws, {
                            type: "partyJoined",
                            code
                        });

                        broadcastLobby(party);

                    }

                    return;
                }

                /* ---------------------------
                   START GAME
                --------------------------- */

                if (
                    data.type ===
                    "startGame"
                ) {

                    if (!player) {

                        send(ws, {
                            type: "error",
                            message:
                                "You are not in a party."
                        });

                        return;

                    }

                    const party =
                        parties.get(
                            player.party
                        );

                    if (!party)
                        return;

                    if (
                        party.host !==
                        player.id
                    ) {

                        send(ws, {
                            type: "error",
                            message:
                                "Only the host can start."
                        });

                        return;

                    }

                    party.started = true;

                    for (
                        const p
                        of party.players.values()
                    ) {

                        send(
                            p.ws,
                            {
                                type:
                                    "gameStarted"
                            }
                        );

                    }

                    return;
                }

                /* ---------------------------
                   GAME JOIN
                --------------------------- */

                if (
                    data.type ===
                    "gameJoin"
                ) {

                    const token =
                        String(
                            data.token || ""
                        );

                    const code =
                        String(
                            data.code || ""
                        )
                        .toUpperCase();

                    const existing =
                        sessions.get(token);

                    const party =
                        parties.get(code);

                    if (
                        !existing ||
                        !party ||
                        existing.party !== code
                    ) {

                        send(ws, {
                            type: "error",
                            message:
                                "Could not reconnect to the game."
                        });

                        return;

                    }

                    /*
                     * Important:
                     * Replace the old lobby socket
                     * instead of creating a second player.
                     */

                    existing.ws =
                        ws;

                    player =
                        existing;

                    send(ws, {
                        type: "gameJoined",
                        keyCollected:
                            party.keyCollected
                    });

                    broadcastPlayers(
                        party
                    );

                    return;
                }

                /* ---------------------------
                   PLAYER MOVEMENT
                --------------------------- */

                if (
                    data.type ===
                    "playerUpdate"
                ) {

                    if (!player)
                        return;

                    const party =
                        parties.get(
                            player.party
                        );

                    if (!party)
                        return;

                    player.x =
                        Number(data.x) || 0;

                    player.y =
                        Number(data.y) || 1.6;

                    player.z =
                        Number(data.z) || 0;

                    broadcastPlayers(
                        party
                    );

                    return;
                }

                /* ---------------------------
                   COLLECT KEY
                --------------------------- */

                if (
                    data.type ===
                    "collectKey"
                ) {

                    if (!player)
                        return;

                    const party =
                        parties.get(
                            player.party
                        );

                    if (!party)
                        return;

                    if (
                        party.keyCollected
                    )
                        return;

                    party.keyCollected =
                        true;

                    for (
                        const p
                        of party.players.values()
                    ) {

                        send(
                            p.ws,
                            {
                                type:
                                    "keyCollected"
                            }
                        );

                    }

                    return;
                }

                /* ---------------------------
                   WIN
                --------------------------- */

                if (
                    data.type ===
                    "gameWon"
                ) {

                    if (!player)
                        return;

                    const party =
                        parties.get(
                            player.party
                        );

                    if (!party)
                        return;

                    for (
                        const p
                        of party.players.values()
                    ) {

                        send(
                            p.ws,
                            {
                                type:
                                    "gameWon",
                                name:
                                    player.name
                            }
                        );

                    }

                    return;
                }

                /* ---------------------------
                   GAME OVER
                --------------------------- */

                if (
                    data.type ===
                    "gameOver"
                ) {

                    if (!player)
                        return;

                    const party =
                        parties.get(
                            player.party
                        );

                    if (!party)
                        return;

                    for (
                        const p
                        of party.players.values()
                    ) {

                        send(
                            p.ws,
                            {
                                type:
                                    "gameOver",
                                name:
                                    player.name
                            }
                        );

                    }

                    return;
                }

            }
        );

        ws.on(
            "close",
            () => {

                /*
                 * Only remove the player if this
                 * socket is still their current socket.
                 */

                if (
                    player &&
                    player.ws === ws
                ) {

                    removePlayer(
                        player
                    );

                }

            }
        );

    }
);

server.listen(
    PORT,
    () => {

        console.log(
            `THE BACKROOMS server running on port ${PORT}`
        );

    }
);
