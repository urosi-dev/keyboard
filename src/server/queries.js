import pg from "pg";
import { config } from "dotenv";
const { Client } = pg;

config();

const client = new Client({
  // host: process.env.DB_HOST,
  // database: process.env.DB_NAME,
  // port: process.env.DB_PORT,
  // user: process.env.DB_USER,
  // password: process.env.DB_PASS,
  connectionString: process.env.DB_CONNECTION_STRING,
  ssl: {
    rejectUnauthorized: false,
  },
});

// client
//   .connect()
//   .then(() => {
//     console.log("connected to database");
//   })
//   .catch((error) => {
//     console.error(error);
//   });

/**
 * @param {string} sessionID
 * @returns {Promise}
 */
export const findUser = async (sessionID) =>
  client
    .query(
      `select
        keyboard.id,
        keyboard.color
      from
        keyboard
        join session on session.id = keyboard.session_id
      where
        active = true
        and keyboard.session_id = $1`,
      [sessionID],
    )
    .then((res) => res.rows[0])
    .catch((error) => {
      console.error(error);
    });

/**
 * @param {string} keyboardID
 * @param {boolean} status
 * @returns {Promise}
 */
export const updateUserStatus = async (keyboardID, status) =>
  client
    .query(
      `update
        keyboard
      set
        connected = $1
      where
        id = $2
      returning
        connected`,
      [status, keyboardID],
    )
    .then((res) => res.rows[0])
    .catch((error) => {
      console.error(error);
    });

/**
 * @param {string} keyboardID
 * @param {string} color
 * @returns {Promise}
 */
export const updateUserColor = async (keyboardID, color) =>
  client
    .query(
      `update
        keyboard
      set
        color = $1
      where
        id = $2
      returning
        color`,
      [color, keyboardID],
    )
    .then((res) => res.rows[0])
    .catch((error) => {
      console.error(error);
    });
