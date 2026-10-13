import streamDeck from "@elgato/streamdeck";
import { FootageAction } from "./actions/action.js";
import { MarkerAction } from "./actions/marker.js";
import { PovAction } from "./actions/pov.js";
import { RecordAction } from "./actions/record.js";
import { FootageClient } from "./footage.js";

const app = new FootageClient();
streamDeck.actions.registerAction(new RecordAction(app));
streamDeck.actions.registerAction(new PovAction(app));
streamDeck.actions.registerAction(new MarkerAction(app));
streamDeck.actions.registerAction(new FootageAction(app));

app.start();
streamDeck.connect();
