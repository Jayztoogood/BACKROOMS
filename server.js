const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT =
    process.env.PORT || 3000;

const server =
    http.createServer(
        (req, res) => {

            let filePath =
                req.url.split("?")[0];

            if (filePath === "/") {
                filePath = "/index.html";
            }

            filePath =
                path.join(
                    __dirname,
                    filePath
                );

            if (!fs.existsSync(filePath)) {

                res.writeHead(404);
                res.end("Not found");

                return;
            }

            const ext =
                path.extname(
                    filePath
                );

            const types = {

                ".html":
                    "text/html",

                ".js":
                    "text/javascript",

                ".css":
                    "text/css",

                ".json":
                    "application/json",

                ".png":
                    "image/png",

                ".jpg":
                    "image/jpeg",

                ".svg":
                    "image/svg+xml"
            };

            res.writeHead(
                200,
                {
                    "Content-Type":
                        types[ext] ||
                        "application/octet-stream"
                }
            );

            fs.createReadStream(
                filePath
            ).pipe(res);
        }
    );


const wss =
    new WebSocket.Server({
        server
    });


// ============================================================
// DATA
// ============================================================

const parties =
    new Map();

const clients =
    new Map();


// ============================================================
// HELPERS
// ============================================================

function makeId() {

    return (
        Math.random()
            .toString(36)
            .substring(2, 10)
    );
}


function makeCode() {

    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code = "";

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


function cleanName(name) {

    if (
        typeof name !==
        "string"
    ) {

        return "Player";
    }

    name =
        name
            .replace(
                /[^a-zA-Z0-9 _-]/g,
                ""
            )
            .trim()
            .substring(0, 16);

    return name ||
        "Player";
}


function send(ws, data) {

    if (
        ws &&
        ws.readyState ===
        WebSocket.OPEN
    ) {

        ws.send(
            JSON.stringify(data)
        );
    }
}


function broadcast(
    party,
    data
) {

    party.players.forEach(
        player => {

            send(
                player.ws,
                data
            );
        }
    );
}


function sendLobby(
    party
) {

    broadcast(
        party,
        {
            type: "lobby",

            code: party.code,

            hostId: party.hostId,

            started:
                party.started,

            players:
                Array.from(
                    party.players.values()
                ).map(
                    player => ({
                        id:
                            player.id,

                        name:
                            player.name
                    })
                )
        }
    );
}


function removePlayer(
    player
) {

    if (!player.party) {
        return;
    }

    const party =
        parties.get(
            player.party
        );

    if (!party) {
        return;
    }

    party.players.delete(
        player.id
    );

    clients.delete(
        player.ws
    );


    if (
        party.players.size === 0
    ) {

        parties.delete(
            party.code
        );

        return;
    }


    // choose new host

    if (
        party.hostId ===
        player.id
    ) {

        const first =
            party.players
                .values()
                .next()
                .value;

        if (first) {

            party.hostId =
                first.id;
        }
    }


    sendLobby(
        party
    );
}


// ============================================================
// CONNECTION
// ============================================================

wss.on(
    "connection",
    ws => {

        const player = {

            id:
                makeId(),

            ws,

            name:
                "Player",

            party:
                null,

            x: 0,

            z: 0,

            yaw: 0
        };


        clients.set(
            ws,
            player
        );


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


                handleMessage(
                    player,
                    data
                );
            }
        );


        ws.on(
            "close",
            () => {

                removePlayer(
                    player
                );
            }
        );


        ws.on(
            "error",
            () => {

                removePlayer(
                    player
                );
            }
        );
    }
);


// ============================================================
// MESSAGE HANDLER
// ============================================================

function handleMessage(
    player,
    data
) {

    if (
        data.type ===
        "createParty"
    ) {

        createParty(
            player,
            data.name
        );

        return;
    }


    if (
        data.type ===
        "joinParty"
    ) {

        joinParty(
            player,
            data.code,
            data.name
        );

        return;
    }


    if (
        data.type ===
        "startGame"
    ) {

        startGame(
            player
        );

        return;
    }


    if (
        data.type ===
        "gameJoin"
    ) {

        gameJoin(
            player,
            data.code,
            data.name
        );

        return;
    }


    if (
        data.type ===
        "playerUpdate"
    ) {

        updatePlayer(
            player,
            data
        );

        return;
    }


    if (
        data.type ===
        "collectKey"
    ) {

        collectKey(
            player
        );

        return;
    }


    if (
        data.type ===
        "gameWon"
    ) {

        gameWon(
            player
        );

        return;
    }


    if (
        data.type ===
        "gameOver"
    ) {

        gameOver(
            player
        );

        return;
    }
}


// ============================================================
// CREATE PARTY
// ============================================================

function createParty(
    player,
    name
) {

    if (player.party) {

        send(
            player.ws,
            {
                type:
                    "error",

                message:
                    "You are already in a party."
            }
        );

        return;
    }


    const code =
        makeCode();


    const party = {

        code,

        hostId:
            player.id,

        started:
            false,

        keyCollected:
            false,

        players:
            new Map()
    };


    player.name =
        cleanName(name);

    player.party =
        code;


    party.players.set(
        player.id,
        player
    );


    parties.set(
        code,
        party
    );


    send(
        player.ws,
        {

            type:
                "partyCreated",

            playerId:
                player.id,

            code
        }
    );


    sendLobby(
        party
    );
}


// ============================================================
// JOIN PARTY
// ============================================================

function joinParty(
    player,
    code,
    name
) {

    code =
        String(
            code || ""
        )
        .toUpperCase()
        .trim();


    const party =
        parties.get(code);


    if (!party) {

        send(
            player.ws,
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
        party.players.size >= 8
    ) {

        send(
            player.ws,
            {

                type:
                    "error",

                message:
                    "Party is full."
            }
        );

        return;
    }


    if (party.started) {

        send(
            player.ws,
            {

                type:
                    "error",

                message:
                    "The game has already started."
            }
        );

        return;
    }


    player.name =
        cleanName(name);

    player.party =
        code;


    party.players.set(
        player.id,
        player
    );


    send(
        player.ws,
        {

            type:
                "partyJoined",

            playerId:
                player.id,

            code
        }
    );


    sendLobby(
        party
    );
}


// ============================================================
// START GAME
// ============================================================

function startGame(
    player
) {

    if (!player.party) {
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
        party.hostId !==
        player.id
    ) {

        send(
            player.ws,
            {

                type:
                    "error",

                message:
                    "Only the host can start the game."
            }
        );

        return;
    }


    party.started =
        true;

    party.keyCollected =
        false;


    broadcast(
        party,
        {
            type:
                "gameStarted"
        }
    );
}


// ============================================================
// GAME JOIN
// ============================================================

function gameJoin(
    player,
    code,
    name
) {

    code =
        String(
            code || ""
        )
        .toUpperCase()
        .trim();


    const party =
        parties.get(code);


    if (!party) {

        send(
            player.ws,
            {

                type:
                    "error",

                message:
                    "Party no longer exists."
            }
        );

        return;
    }


    // If already connected through lobby,
    // don't add a duplicate player.

    if (
        party.players.has(
            player.id
        )
    ) {

        player.name =
            cleanName(name);

    } else {

        if (
            party.players.size >= 8
        ) {

            send(
                player.ws,
                {

                    type:
                        "error",

                    message:
                        "Party is full."
                }
            );

            return;
        }

        player.name =
            cleanName(name);

        player.party =
            code;

        party.players.set(
            player.id,
            player
        );
    }


    send(
        player.ws,
        {

            type:
                "gameJoined",

            playerId:
                player.id
        }
    );


    sendWorldState(
        party
    );


    broadcastPlayers(
        party
    );
}


// ============================================================
// PLAYER MOVEMENT
// ============================================================

function updatePlayer(
    player,
    data
) {

    if (!player.party) {
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
        Number(data.x);

    const z =
        Number(data.z);

    const yaw =
        Number(data.yaw);


    if (
        Number.isFinite(x)
    ) {

        player.x =
            Math.max(
                -59,
                Math.min(
                    59,
                    x
                )
            );
    }


    if (
        Number.isFinite(z)
    ) {

        player.z =
            Math.max(
                -59,
                Math.min(
                    59,
                    z
                )
            );
    }


    if (
        Number.isFinite(yaw)
    ) {

        player.yaw =
            yaw;
    }
}


// ============================================================
// BROADCAST PLAYER POSITIONS
// ============================================================

setInterval(
    () => {

        for (
            const party
            of parties.values()
        ) {

            if (
                !party.started
            ) {
                continue;
            }

            broadcastPlayers(
                party
            );
        }

    },
    50
);


function broadcastPlayers(
    party
) {

    broadcast(
        party,
        {

            type:
                "players",

            players:
                Array.from(
                    party.players.values()
                ).map(
                    player => ({

                        id:
                            player.id,

                        name:
                            player.name,

                        x:
                            player.x,

                        z:
                            player.z,

                        yaw:
                            player.yaw
                    })
                )
        }
    );
}


// ============================================================
// KEY
// ============================================================

function collectKey(
    player
) {

    if (!player.party) {
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


    sendWorldState(
        party
    );
}


function sendWorldState(
    party
) {

    broadcast(
        party,
        {

            type:
                "worldState",

            keyCollected:
                party.keyCollected
        }
    );
}


// ============================================================
// WIN / LOSE
// ============================================================

function gameWon(
    player
) {

    if (!player.party) {
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
                "gameWon"
        }
    );
}


function gameOver(
    player
) {

    if (!player.party) {
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

            message:
                "A player was caught."
        }
    );
}


// ============================================================
// START SERVER
// ============================================================

server.listen(
    PORT,
    () => {

        console.log(
            `THE BACKROOMS SERVER RUNNING ON PORT ${PORT}`
        );

        console.log(
            `http://localhost:${PORT}`
        );
    }
);
