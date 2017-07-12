import * as express from 'express';
import bodyParser = require('body-parser');
import 'isomorphic-fetch';
import * as uuidv4 from 'uuid/v4';
import { IActivity, IAttachment, IBotData, IChannelAccount, IConversation, IConversationAccount, IEntity, IMessageActivity, IUser } from './types';

const expires_in = 1800;
let conversationId: string;
let botDataStore: { [key: string]: IBotData } = {};
let history: IActivity[];

export const initializeRoutes = (app: express.Server, serviceUrl: string, botUrl: string) => {
    app.use(bodyParser.json()); // for parsing application/json
    app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
    app.use((req, res, next) => {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, PATCH, OPTIONS");
        res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
        next();
    });
    // CLIENT ENDPOINT
    app.options('/directline', (req, res) => {
        res.status(200).end();
    })

    //Creates a conversation
    app.post('/directline/conversations', (req, res) => {
        history = [];
        conversationId = uuidv4();
        console.log("Created conversation with conversationId: " + conversationId);
        res.send({
            conversationId,
            expires_in
        });
    })

    app.listen(3000, () => {
        console.log('listening');
    });

    //reconnect API
    app.get('/v3/directline/conversations/:conversationId', (req, res) => { console.warn("/v3/directline/conversations/:conversationId not implemented") })

    //Gets activities from store (local history array for now)
    app.get('/directline/conversations/:conversationId/activities', (req, res) => {
        let watermark = Number(req.query.watermark || 0);

        if (history) {
            //If the bot has pushed anything into the history array
            if (history.length > watermark) {
                let activities = getActivitiesSince(watermark);
                res.status(200).json({
                    activities,
                    watermark: watermark + activities.length
                });
            } else {
                res.status(200).send({
                    activities: [],
                    watermark
                })
            }
        } else {
            console.warn("Client is polling connector before conversation is initialized.");
            res.status(400).send;
        }
    })

    //Sends message to bot. Assumes message activities. 
    app.post('/directline/conversations/:conversationId/activities', (req, res) => {
        let text = req.body.text;
        //make copy of activity. Add required fields. 
        let activity = createMessageActivity(text, serviceUrl);
        fetch(botUrl, {
            method: "POST",
            body: JSON.stringify(activity),
            headers: {
                "Content-Type": "application/json"
            }
        })
    })

    app.post('/v3/directline/conversations/:conversationId/upload', (req, res) => { console.warn("/v3/directline/conversations/:conversationId/upload not implemented") })
    app.get('/v3/directline/conversations/:conversationId/stream', (req, res) => { console.warn("/v3/directline/conversations/:conversationId/stream not implemented") })

    // BOT CONVERSATION ENDPOINT

    app.post('/v3/conversations', (req, res) => { console.warn("/v3/conversations not implemented") })
    app.post('/v3/conversations/:conversationId/activities', (req, res) => { console.warn("/v3/conversations/:conversationId/activities") })

    app.post('/v3/conversations/:conversationId/activities/:activityId', (req, res) => {
        let activity: IActivity;

        activity = req.body;
        activity.id = uuidv4();
        activity.from = { id: "id", name: "Bot" };

        if (history) {
            history.push(activity);
            res.status(200).send();
        } else {
            console.warn("Client is attempting to send messages before conversation is initialized.");
            res.status(400).send();
        }

    })

    app.get('/v3/conversations/:conversationId/members', (req, res) => { console.warn("/v3/conversations/:conversationId/members not implemented") })
    app.get('/v3/conversations/:conversationId/activities/:activityId/members', (req, res) => { console.warn("/v3/conversations/:conversationId/activities/:activityId/members") })

    // BOTSTATE ENDPOINT

    app.get('/v3/botstate/:channelId/users/:userId', (req, res) => {
        console.log("Called GET user data");
        getBotData(req, res);
    })

    app.get('/v3/botstate/:channelId/conversations/:conversationId', (req, res) => {
        console.log(("Called GET conversation data"));
        getBotData(req, res);
    })

    app.get('/v3/botstate/:channelId/conversations/:conversationId/users/:userId', (req, res) => {
        console.log("Called GET private conversation data");
        getBotData(req, res);
    })

    app.post('/v3/botstate/:channelId/users/:userId', (req, res) => {
        console.log("Called POST setUserData");
        setUserData(req, res);
    })

    app.post('/v3/botstate/:channelId/conversations/:conversationId', (req, res) => {
        console.log("Called POST setConversationData");
        setConversationData(req, res);
    })

    app.post('/v3/botstate/:channelId/conversations/:conversationId/users/:userId', (req, res) => {
        setPrivateConversationData(req, res);
    })

    app.delete('/v3/botstate/:channelId/users/:userId', (req, res) => {
        console.log("Called DELETE deleteStateForUser");
        deleteStateForUser(req, res);
    })

}

const getBotDataKey = (channelId: string, conversationId: string, userId: string) => {
    return `$${channelId || '*'}!${conversationId || '*'}!${userId || '*'}`;
}

const setBotData = (channelId: string, conversationId: string, userId: string, incomingData: IBotData): IBotData => {
    const key = getBotDataKey(channelId, conversationId, userId);
    let newData: IBotData = {
        eTag: new Date().getTime().toString(),
        data: incomingData.data
    };

    if (incomingData) {
        botDataStore[key] = newData;
    } else {
        delete botDataStore[key];
        newData.eTag = '*';
    }

    return newData;
}

const getBotData = (req: express.Request, res: express.Response) => {
    const key = getBotDataKey(req.params.channelId, req.params.conversationId, req.params.userId);
    console.log("Data key: " + key);

    res.status(200).send(botDataStore[key] || { data: null, eTag: '*' });
}

const setUserData = (req: express.Request, res: express.Response) => {
    res.status(200).send(setBotData(req.params.channelId, req.params.conversationId, req.params.userId, req.body));
}

const setConversationData = (req: express.Request, res: express.Response) => {
    res.status(200).send(setBotData(req.params.channelId, req.params.conversationId, req.params.userId, req.body));
}

const setPrivateConversationData = (req: express.Request, res: express.Response) => {
    res.status(200).send(setBotData(req.params.channelId, req.params.conversationId, req.params.userId, req.body));
}

const deleteStateForUser = (req: express.Request, res: express.Response) => {
    Object.keys(botDataStore)
        .forEach(key => {
            if (key.endsWith(`!{req.query.userId}`)) {
                delete botDataStore[key];
            }
        });
    res.status(200);
}

//CLIENT ENDPOINT HELPERS
const createMessageActivity = (text: string, serviceUrl: string): IMessageActivity => {
    let activity: IMessageActivity = {};
    activity.type = "message";
    activity.text = text;
    activity.from = { 'id': '12345', 'name': 'User' };
    activity.timestamp = (new Date).toISOString();
    activity.localTimestamp = (new Date).toISOString();
    activity.id = uuidv4();
    activity.channelId = "emulator";
    activity.conversation = { 'id': conversationId };
    activity.serviceUrl = serviceUrl;

    return activity;
}

const getActivitiesSince = (watermark: number): IActivity[] => {
    return history.slice(watermark);
}


