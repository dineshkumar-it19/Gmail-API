const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');
const axios = require('axios');

const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];
const TOKEN_PATH = 'token.json';

// Load client secrets from a local file.
fs.readFile('client_secret.json', (err, content) => {
  if (err) {
    console.error('Error loading client secret file:', err);
    return;
  }
  // Authorize a client with the loaded credentials, then call the Gmail API.
  authorize(JSON.parse(content), listLabels);
});

/**
 * Create an OAuth2 client with the given credentials and token, and then execute the
 * given callback function.
 *
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) {
      return getNewToken(oAuth2Client, callback);
    }
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/** 
 Get and store new token after prompting for user authorization, and then
  execute the given callback with the authorized OAuth2 client.
 
  @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
  @param {function} callback The callback to call with the authorized client.
 */
function getNewToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) {
        console.error('Error retrieving access token:', err);
        return;
      }
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) {
          console.error('Error storing access token:', err);
          return;
        }
        console.log('Token stored to', TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}

/**
 * Lists the labels in the user's Gmail account.
 
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function listLabels(auth) {
  const gmail = google.gmail({ version: 'v1', auth });
  gmail.users.labels.list(
    {
      userId: 'me',
    },
    (err, res) => {
      if (err) {
        console.error('The API returned an error:', err);
        return;
      }
      const labels = res.data.labels;
      if (labels.length) {
        console.log('Labels:');
        labels.forEach((label) => {
          console.log(`- ${label.name}`);
        });
      } else {
        console.log('No labels found.');
      }
    }
  );
}

/**
 * Sends a reply to the specified email thread.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 * @param {string} threadId The ID of the email thread.
 */
async function sendReply(auth, threadId) {
  try {
    const gmail = google.gmail({ version: 'v1', auth });
    const message = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        threadId,
        raw: Buffer.from('send reply').toString('base64'), // Replace with your reply email content
      },
    });
    console.log('Reply sent:', message.data);
  } catch (error) {
    console.error('Error sending reply:', error);
  }
}

/**
 * Checks for new emails in the user's Gmail account and sends replies if necessary.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function checkAndReplyToEmails(auth) {
  const gmail = google.gmail({ version: 'v1', auth });

  // Get all threads in the Inbox
  const res = await gmail.users.threads.list({
    userId: 'me',
    q: 'in:inbox',
  });

  if (res && res.data && res.data.threads) {
    const threads = res.data.threads;
    for (const thread of threads) {
      // Check if the thread has prior replies from the user
      const replyRes = await gmail.users.messages.list({
        userId: 'me',
        q: `in:inbox thread:${thread.id} from:me`,
      });

      if (!replyRes.data.messages || replyRes.data.messages.length === 0) {
        // No prior replies sent, send a reply
        await sendReply(auth, thread.id);

        // Add a label to the email thread
        await addLabelToEmail(auth, thread.id, 'Vacation Reply');
      }
    }
  }
}

/**
 * Adds a label to the specified email thread.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 * @param {string} threadId The ID of the email thread.
 * @param {string} labelName The name of the label to add.
 */
async function addLabelToEmail(auth, threadId, labelName) {
  const gmail = google.gmail({ version: 'v1', auth });

  // Check if the label already exists
  const labelsRes = await gmail.users.labels.list({ userId: 'me' });
  const label = labelsRes.data.labels.find((l) => l.name === labelName);

  if (label) {
    // Add the label to the email thread
    await gmail.users.threads.modify({
      userId: 'me',
      id: threadId,
      requestBody: {
        addLabelIds: [label.id],
      },
    });
  } else {
    // Create a new label
    const createLabelRes = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: labelName,
      },
    });

    if (createLabelRes && createLabelRes.data) {
      const newLabel = createLabelRes.data;
      // Add the label to the email thread
      await gmail.users.threads.modify({
        userId: 'me',
        id: threadId,
        requestBody: {
          addLabelIds: [newLabel.id],
        },
      });
    }
  }
}

// Run the app in random intervals of 45 to 120 seconds
setInterval(() => {
  authorize(JSON.parse(fs.readFileSync('client_secret.json')), checkAndReplyToEmails);
}, getRandomInterval(45000, 120000));

/**
 * Generates a random interval between the specified min and max values.
 *
 * @param {number} min The minimum interval duration in milliseconds.
 * @param {number} max The maximum interval duration in milliseconds.
 * @returns {number} The generated random interval duration.
 */
function getRandomInterval(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
