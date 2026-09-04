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


/* =========================================================
   HELPERS
========================================================= */

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


function broadcast(party, data) {

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


function makeCode() {

    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code;

    do {

        code = "";

        for (
            let i = 0;
            i < 5;
            i++
        ) {

            code += chars[
                Math.floor(
                    Math.random() *
                    chars.length
                )
            ];

        }

    } while (
        parties.has(code)
    );

    return code;

}


function makeToken() {

    return crypto
        .randomBytes(24)
        .toString("hex");

}


function cleanName(name) {

    let result =
        String(
            name || "Player"
        )
        .replace(
            /[^a-zA-Z0-9 _-]/g,
            ""
        )
        .trim()
        .slice(0, 16);

    return result ||
        "Player";

}


/* =========================================================
   LOBBY
========================================================= */

function lobbyPlayers(party) {

    return [
        ...party.players.values()
    ].map(
        player => ({

            id:
                player.id,

            name:
                player.name,

            host:
                player.id ===
                party.host

        })
    );

}


/*
 * IMPORTANT:
 *
 * Every player receives their OWN
 * youAreHost value.
 */

function broadcastLobby(party) {

    const players =
        lobbyPlayers(party);


    for (
        const player
        of party.players.values()
    ) {

        send(
            player.ws,
            {

                type:
                    "lobby",

                code:
                    party.code,

                players,

                youAreHost:
                    player.id ===
                    party.host

            }
        );

    }

}


/* =========================================================
   PLAYER POSITIONS
========================================================= */

function broadcastPlayers(party) {

    const players =
        [
            ...party.players.values()
        ].map(
            player => ({

                id:
                    player.id,

                name:
                    player.name,

                x:
                    player.x || -42,

                y:
                    player.y || 1.6,

                z:
                    player.z || 42

            })
        );


    broadcast(
        party,
        {

            type:
                "players",

            players

        }
    );

}


/* =========================================================
   REMOVE PLAYER
========================================================= */

function removePlayer(player) {

    if (!player)
        return;


    if (!player.party)
        return;


    const party =
        parties.get(
            player.party
        );


    if (!party)
        return;


    /*
     * Don't delete the player if this is
     * an old socket and they already
     * reconnected with a new socket.
     */

    if (
        player.ws &&
        player.ws._closingHandled
    ) {
        return;
    }


    party.players.delete(
        player.id
    );


    sessions.delete(
        player.id
    );


    /*
     * Give host control to another player.
     */

    if (
        party.host ===
        player.id
    ) {

        const next =
            party.players
                .values()
                .next();


        if (!next.done) {

            party.host =
                next.value.id;

        }

    }


    if (
        party.players.size === 0
    ) {

        parties.delete(
            party.code
        );

        return;

    }


    broadcastLobby(
        party
    );

    broadcastPlayers(
        party
    );

}


/* =========================================================
   HTTP SERVER
========================================================= */

const server =
    http.createServer(
        (req, res) => {

            let requestPath =
                req.url.split("?")[0];


            if (
                requestPath === "/"
            ) {

                requestPath =
                    "/index.html";

            }


            let filePath =
                path.normalize(
                    path.join(
                        __dirname,
                        requestPath
                    )
                );


            if (
                !filePath.startsWith(
                    __dirname
                )
            ) {

                res.writeHead(403);

                res.end(
                    "Forbidden"
                );

                return;

            }


            fs.readFile(
                filePath,
                (err, data) => {

                    if (err) {

                        res.writeHead(
                            404
                        );

                        res.end(
                            "Not Found"
                        );

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
                                "application/octet-stream",

                            "Cache-Control":
                                "no-cache"
                        }
                    );


                    res.end(
                        data
                    );

                }
            );

        }
    );


/* =========================================================
   WEBSOCKET SERVER
========================================================= */

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

                    send(
                        ws,
                        {
                            type:
                                "error",

                            message:
                                "Invalid message."
                        }
                    );

                    return;

                }


                /* =================================================
                   CREATE PARTY
                ================================================= */

                if (
                    data.type ===
                    "createParty"
                ) {

                    const name =
                        cleanName(
                            data.name
                        );


                    const code =
                        makeCode();


                    const token =
                        makeToken();


                    const newPlayer = {

                        id:
                            token,

                        name:
                            name,

                        party:
                            code,

                        ws:
                            ws,

                        x:
                            -42,

                        y:
                            1.6,

                        z:
                            42

                    };


                    const party = {

                        code:
                            code,

                        host:
                            token,

                        started:
                            false,

                        keyCollected:
                            false,

                        players:
                            new Map()

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


                    /*
                     * Send session FIRST.
                     */

                    send(
                        ws,
                        {

                            type:
                                "session",

                            token:
                                token

                        }
                    );


                    /*
                     * Tell creator they are
                     * the host.
                     */

                    send(
                        ws,
                        {

                            type:
                                "partyCreated",

                            code:
                                code,

                            host:
                                true

                        }
                    );


                    /*
                     * Send lobby with
                     * youAreHost:true.
                     */

                    broadcastLobby(
                        party
                    );


                    return;

                }


                /* =================================================
                   JOIN PARTY
                ================================================= */

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
                        cleanName(
                            data.name
                        );


                    const party =
                        parties.get(
                            code
                        );


                    if (!party) {

                        send(
                            ws,
                            {
                                type:
                                    "error",

                                message:
                                    "Party not found."
                            }
                        );

                        return;

                    }


                    if (
                        party.started
                    ) {

                        send(
                            ws,
                            {
                                type:
                                    "error",

                                message:
                                    "The game has already started."
                            }
                        );

                        return;

                    }


                    if (
                        party.players.size >=
                        8
                    ) {

                        send(
                            ws,
                            {
                                type:
                                    "error",

                                message:
                                    "Party is full."
                            }
                        );

                        return;

                    }


                    const token =
                        makeToken();


                    const newPlayer = {

                        id:
                            token,

                        name:
                            name,

                        party:
                            code,

                        ws:
                            ws,

                        x:
                            -42,

                        y:
                            1.6,

                        z:
                            42

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


                    send(
                        ws,
                        {

                            type:
                                "session",

                            token:
                                token

                        }
                    );


                    send(
                        ws,
                        {

                            type:
                                "partyJoined",

                            code:
                                code,

                            host:
                                false

                        }
                    );


                    broadcastLobby(
                        party
                    );


                    return;

                }


                /* =================================================
                   RECONNECT
                ================================================= */

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
                        .trim()
                        .toUpperCase();


                    const existing =
                        sessions.get(
                            token
                        );


                    const party =
                        parties.get(
                            code
                        );


                    if (
                        !existing ||
                        !party ||
                        existing.party !== code
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "Your party session expired."

                            }
                        );

                        return;

                    }


                    /*
                     * Replace old socket.
                     */

                    const oldSocket =
                        existing.ws;


                    existing.ws =
                        ws;


                    player =
                        existing;


                    /*
                     * Prevent the old socket from
                     * deleting this player.
                     */

                    if (
                        oldSocket &&
                        oldSocket !== ws
                    ) {

                        oldSocket._replaced =
                            true;

                    }


                    send(
                        ws,
                        {

                            type:
                                "session",

                            token:
                                token

                        }
                    );


                    if (
                        party.started
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "gameStarted"

                            }
                        );

                    } else {

                        send(
                            ws,
                            {

                                type:
                                    "partyJoined",

                                code:
                                    code,

                                host:
                                    existing.id ===
                                    party.host

                            }
                        );


                        broadcastLobby(
                            party
                        );

                    }


                    return;

                }


                /* =================================================
                   START GAME
                ================================================= */

                if (
                    data.type ===
                    "startGame"
                ) {

                    if (!player) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "You are not in a party."

                            }
                        );

                        return;

                    }


                    const party =
                        parties.get(
                            player.party
                        );


                    if (!party)
                        return;


                    /*
                     * SERVER-SIDE HOST CHECK
                     */

                    if (
                        player.id !==
                        party.host
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "Only the host can start the game."

                            }
                        );

                        return;

                    }


                    if (
                        party.started
                    ) {

                        return;

                    }


                    party.started =
                        true;


                    /*
                     * START FOR EVERYONE.
                     */

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


                /* =================================================
                   GAME JOIN
                ================================================= */

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
                        .trim()
                        .toUpperCase();


                    const existing =
                        sessions.get(
                            token
                        );


                    const party =
                        parties.get(
                            code
                        );


                    if (
                        !existing ||
                        !party ||
                        existing.party !== code
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "Could not reconnect to the game."

                            }
                        );

                        return;

                    }


                    /*
                     * Replace the lobby socket with
                     * the game socket.
                     */

                    const oldSocket =
                        existing.ws;


                    existing.ws =
                        ws;


                    player =
                        existing;


                    if (
                        oldSocket &&
                        oldSocket !== ws
                    ) {

                        oldSocket._replaced =
                            true;

                    }


                    send(
                        ws,
                        {

                            type:
                                "gameJoined",

                            keyCollected:
                                party.keyCollected

                        }
                    );


                    broadcastPlayers(
                        party
                    );


                    return;

                }


                /* =================================================
                   PLAYER UPDATE
                ================================================= */

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


                    const x =
                        Number(
                            data.x
                        );


                    const y =
                        Number(
                            data.y
                        );


                    const z =
                        Number(
                            data.z
                        );


                    if (
                        Number.isFinite(x)
                    ) {

                        player.x =
                            Math.max(
                                -60,
                                Math.min(
                                    60,
                                    x
                                )
                            );

                    }


                    if (
                        Number.isFinite(y)
                    ) {

                        player.y =
                            y;

                    }


                    if (
                        Number.isFinite(z)
                    ) {

                        player.z =
                            Math.max(
                                -60,
                                Math.min(
                                    60,
                                    z
                                )
                            );

                    }


                    broadcastPlayers(
                        party
                    );


                    return;

                }


                /* =================================================
                   KEY
                ================================================= */

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
                    ) {

                        return;

                    }


                    party.keyCollected =
                        true;


                    broadcast(
                        party,
                        {

                            type:
                                "keyCollected"

                        }
                    );


                    return;

                }


                /* =================================================
                   WIN
                ================================================= */

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


                    broadcast(
                        party,
                        {

                            type:
                                "gameWon",

                            name:
                                player.name

                        }
                    );


                    return;

                }


                /* =================================================
                   GAME OVER
                ================================================= */

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


                    broadcast(
                        party,
                        {

                            type:
                                "gameOver",

                            name:
                                player.name

                        }
                    );


                    return;

                }

            }
        );


        ws.on(
            "close",
            () => {

                /*
                 * If this socket was replaced by a
                 * newer socket, DON'T remove the player.
                 */

                if (
                    ws._replaced
                ) {

                    return;

                }


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


        ws.on(
            "error",
            () => {

                if (
                    ws._replaced
                ) {

                    return;

                }


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


/* =========================================================
   SERVER
========================================================= */

server.listen(
    PORT,
    () => {

        console.log(
            `THE BACKROOMS server running on port ${PORT}`
        );

    }
);
