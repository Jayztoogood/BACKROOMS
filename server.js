const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");


const PORT =
    process.env.PORT || 3000;


const parties =
    new Map();


const sessions =
    new Map();


const MIME = {

    ".html":
        "text/html; charset=utf-8",

    ".js":
        "text/javascript; charset=utf-8",

    ".css":
        "text/css; charset=utf-8",

    ".json":
        "application/json; charset=utf-8",

    ".png":
        "image/png",

    ".jpg":
        "image/jpeg",

    ".jpeg":
        "image/jpeg",

    ".svg":
        "image/svg+xml",

    ".ico":
        "image/x-icon"

};


/* =========================================================
   HELPERS
========================================================= */

function send(
    ws,
    data
) {

    if (
        ws &&
        ws.readyState ===
            WebSocket.OPEN
    ) {

        ws.send(
            JSON.stringify(
                data
            )
        );

    }

}


function broadcast(
    party,
    data
) {

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

            code +=
                chars[
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
        .randomBytes(
            24
        )
        .toString(
            "hex"
        );

}


function cleanName(
    name
) {

    const result =
        String(
            name ||
            "Player"
        )
        .replace(
            /[^a-zA-Z0-9 _-]/g,
            ""
        )
        .trim()
        .slice(
            0,
            16
        );


    return result ||
        "Player";

}


/* =========================================================
   LOBBY
========================================================= */

function getLobbyPlayers(
    party
) {

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


function sendLobby(
    party
) {

    const players =
        getLobbyPlayers(
            party
        );


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

                host:
                    party.host,

                players:
                    players,

                youAreHost:
                    player.id ===
                    party.host

            }
        );

    }

}


/* =========================================================
   GAME PLAYERS
========================================================= */

function sendPlayers(
    party
) {

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
                    Number.isFinite(
                        player.x
                    )
                    ? player.x
                    : -50,

                y:
                    Number.isFinite(
                        player.y
                    )
                    ? player.y
                    : 1.6,

                z:
                    Number.isFinite(
                        player.z
                    )
                    ? player.z
                    : 40

            })
        );


    broadcast(
        party,
        {

            type:
                "players",

            players:
                players

        }
    );

}


/* =========================================================
   REMOVE PLAYER
========================================================= */

function removePlayer(
    player
) {

    if (!player) {
        return;
    }


    const party =
        parties.get(
            player.party
        );


    if (!party) {
        return;
    }


    if (
        party.players.get(
            player.id
        ) !==
        player
    ) {

        return;

    }


    if (
        player.disconnectTimer
    ) {

        clearTimeout(
            player.disconnectTimer
        );

        player.disconnectTimer =
            null;

    }


    party.players.delete(
        player.id
    );


    sessions.delete(
        player.id
    );


    /*
     * Transfer host.
     */

    if (
        party.host ===
        player.id
    ) {

        const next =
            party.players
                .values()
                .next();


        if (
            !next.done
        ) {

            party.host =
                next.value.id;

        }

    }


    /*
     * Delete empty party.
     */

    if (
        party.players.size ===
        0
    ) {

        parties.delete(
            party.code
        );

        return;

    }


    sendLobby(
        party
    );


    sendPlayers(
        party
    );

}


/* =========================================================
   DISCONNECT
========================================================= */

function handleDisconnect(
    player,
    socket
) {

    if (!player) {
        return;
    }


    /*
     * Don't remove a player if their
     * socket has already been replaced.
     */

    if (
        player.ws !==
        socket
    ) {

        return;

    }


    const party =
        parties.get(
            player.party
        );


    if (!party) {
        return;
    }


    /*
     * Once game has started, the old
     * lobby socket will close when the
     * player moves to game.html.
     *
     * Keep their session alive for 60 sec.
     */

    if (
        party.started
    ) {

        const oldSocket =
            socket;


        if (
            player.disconnectTimer
        ) {

            clearTimeout(
                player.disconnectTimer
            );

        }


        player.disconnectTimer =
            setTimeout(
                () => {

                    /*
                     * New game socket arrived.
                     */

                    if (
                        player.ws !==
                        oldSocket
                    ) {

                        return;

                    }


                    /*
                     * Nobody reconnected.
                     */

                    removePlayer(
                        player
                    );

                },
                60000
            );


        return;

    }


    /*
     * Before game starts,
     * remove immediately.
     */

    removePlayer(
        player
    );

}


/* =========================================================
   HTTP SERVER
========================================================= */

const server =
    http.createServer(
        (
            req,
            res
        ) => {

            let requestPath =
                req.url.split("?")[0];


            if (
                requestPath ===
                "/"
            ) {

                requestPath =
                    "/index.html";

            }


            const filePath =
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

                res.writeHead(
                    403
                );


                res.end(
                    "Forbidden"
                );


                return;

            }


            fs.readFile(
                filePath,
                (
                    err,
                    data
                ) => {

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
                                "no-store"

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
   WEBSOCKET
========================================================= */

const wss =
    new WebSocket.Server({
        server
    });


wss.on(
    "connection",
    ws => {

        let player =
            null;


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


                /* =============================================
                   CREATE PARTY
                ============================================== */

                if (
                    data.type ===
                    "createParty"
                ) {

                    if (
                        player
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "You are already connected."

                            }
                        );


                        return;

                    }


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
                            -50,

                        y:
                            1.6,

                        z:
                            40,

                        disconnectTimer:
                            null

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
                                "partyCreated",

                            code:
                                code,

                            token:
                                token,

                            host:
                                true

                        }
                    );


                    sendLobby(
                        party
                    );


                    return;

                }


                /* =============================================
                   JOIN PARTY
                ============================================== */

                if (
                    data.type ===
                    "joinParty"
                ) {

                    if (
                        player
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "You are already connected."

                            }
                        );


                        return;

                    }


                    const code =
                        String(
                            data.code ||
                            ""
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
                            -50,

                        y:
                            1.6,

                        z:
                            40,

                        disconnectTimer:
                            null

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

                            token:
                                token,

                            host:
                                false

                        }
                    );


                    sendLobby(
                        party
                    );


                    return;

                }


                /* =============================================
                   RECONNECT
                ============================================== */

                if (
                    data.type ===
                    "reconnect"
                ) {

                    const token =
                        String(
                            data.token ||
                            ""
                        );


                    const code =
                        String(
                            data.code ||
                            ""
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
                        existing.party !==
                            code
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


                    if (
                        existing.disconnectTimer
                    ) {

                        clearTimeout(
                            existing.disconnectTimer
                        );


                        existing.disconnectTimer =
                            null;

                    }


                    const oldSocket =
                        existing.ws;


                    existing.ws =
                        ws;


                    player =
                        existing;


                    if (
                        oldSocket &&
                        oldSocket !==
                            ws
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
                                    "gameStarted",

                                code:
                                    code,

                                token:
                                    token

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

                                token:
                                    token,

                                host:
                                    existing.id ===
                                    party.host

                            }
                        );


                        sendLobby(
                            party
                        );

                    }


                    return;

                }


                /* =============================================
                   CHECK PARTY
                ============================================== */

                if (
                    data.type ===
                    "checkParty"
                ) {

                    const token =
                        String(
                            data.token ||
                            ""
                        );


                    const code =
                        String(
                            data.code ||
                            ""
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
                        existing.party !==
                            code
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "Your party session could not be found."

                            }
                        );


                        return;

                    }


                    /*
                     * This player is actively
                     * connected.
                     */

                    existing.ws =
                        ws;


                    player =
                        existing;


                    if (
                        existing.disconnectTimer
                    ) {

                        clearTimeout(
                            existing.disconnectTimer
                        );


                        existing.disconnectTimer =
                            null;

                    }


                    send(
                        ws,
                        {

                            type:
                                "partyStatus",

                            code:
                                party.code,

                            started:
                                party.started,

                            token:
                                existing.id

                        }
                    );


                    return;

                }


                /* =============================================
                   START GAME
                ============================================== */

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


                    if (!party) {

                        return;

                    }


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
                     * EVERY player gets
                     * their OWN token.
                     */

                    for (
                        const p
                        of party.players.values()
                    ) {

                        send(
                            p.ws,
                            {

                                type:
                                    "gameStarted",

                                code:
                                    party.code,

                                token:
                                    p.id

                            }
                        );

                    }


                    return;

                }


                /* =============================================
                   GAME JOIN
                ============================================== */

                if (
                    data.type ===
                    "gameJoin"
                ) {

                    const token =
                        String(
                            data.token ||
                            ""
                        );


                    const code =
                        String(
                            data.code ||
                            ""
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
                        existing.party !==
                            code
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "Could not reconnect to your party."

                            }
                        );


                        return;

                    }


                    if (
                        existing.disconnectTimer
                    ) {

                        clearTimeout(
                            existing.disconnectTimer
                        );


                        existing.disconnectTimer =
                            null;

                    }


                    const oldSocket =
                        existing.ws;


                    existing.ws =
                        ws;


                    player =
                        existing;


                    if (
                        oldSocket &&
                        oldSocket !==
                            ws
                    ) {

                        oldSocket._replaced =
                            true;

                    }


                    send(
                        ws,
                        {

                            type:
                                "gameJoined",

                            token:
                                token,

                            keyCollected:
                                party.keyCollected

                        }
                    );


                    sendPlayers(
                        party
                    );


                    return;

                }


                /* =============================================
                   PLAYER POSITION
                ============================================== */

                if (
                    data.type ===
                    "playerUpdate"
                ) {

                    if (!player) {

                        return;

                    }


                    const party =
                        parties.get(
                            player.party
                        );


                    if (!party) {

                        return;

                    }


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
                                -100,
                                Math.min(
                                    100,
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
                                -100,
                                Math.min(
                                    100,
                                    z
                                )
                            );

                    }


                    sendPlayers(
                        party
                    );


                    return;

                }


                /* =============================================
                   KEY
                ============================================== */

                if (
                    data.type ===
                    "collectKey"
                ) {

                    if (!player) {

                        return;

                    }


                    const party =
                        parties.get(
                            player.party
                        );


                    if (!party) {

                        return;

                    }


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


                /* =============================================
                   WIN
                ============================================== */

                if (
                    data.type ===
                    "gameWon"
                ) {

                    if (!player) {

                        return;

                    }


                    const party =
                        parties.get(
                            player.party
                        );


                    if (!party) {

                        return;

                    }


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


                /* =============================================
                   GAME OVER
                ============================================== */

                if (
                    data.type ===
                    "gameOver"
                ) {

                    if (!player) {

                        return;

                    }


                    const party =
                        parties.get(
                            player.party
                        );


                    if (!party) {

                        return;

                    }


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


        /* =====================================================
           CLOSE
        ===================================================== */

        ws.on(
            "close",
            () => {

                /*
                 * Don't remove player if this is
                 * an old socket that has been replaced.
                 */

                if (
                    ws._replaced
                ) {

                    return;

                }


                handleDisconnect(
                    player,
                    ws
                );

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


                handleDisconnect(
                    player,
                    ws
                );

            }
        );

    }
);


/* =========================================================
   START SERVER
========================================================= */

server.listen(
    PORT,
    () => {

        console.log(
            "================================="
        );

        console.log(
            "THE BACKROOMS SERVER STARTED"
        );

        console.log(
            `PORT: ${PORT}`
        );

        console.log(
            "================================="
        );

    }
);
