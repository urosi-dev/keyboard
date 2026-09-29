import fs from "fs";

/**
 * @param {string} sessionID
 * @returns {Promise<{
 *  id: string,
 *  updated_at: string,
 *  color: string,
 *  connected: 'true' | 'false',
 *  session_id: string,
 *  created_at: string,
 *  active: 'true' | 'false',
 * }>
 */
export const findUser = async (sessionID) => {
  const user = {};

  try {
    const data = await fs.promises.readFile("keyboard.csv", "utf8");
    const rows = data.split("\n");
    const headers = rows[0].split(",").map((header) => header.trim());

    for (let i = 0; i < rows.length; i++) {
      const values = rows[i].split(",");
      if (values[4] === sessionID) {
        for (let i = 0; i < headers.length; i++) {
          user[headers[i]] = values[i];
        }
      }
    }
  } catch (error) {
    console.error(error);
  }

  return user;
};

export const getAllUsers = async () => {
  const data = await fs.promises.readFile("keyboard.csv", "utf8");
  const rows = data.split("\n");
  const headers = rows[0].split(",").map((header) => header.trim());
  const users = [];

  for (let i = 1; i < rows.length; i++) {
    if (!rows[i]) continue;
    const user = {};
    const values = rows[i].split(",");
    for (let j = 0; j < headers.length; j++) {
      user[headers[j]] = values[j];
    }
    users.push(user);
  }

  return users;
}

export const updateUserStatus = async (keyboardID, status) => {
  const data = await fs.promises.readFile("keyboard.csv", "utf8");
  const rows = data.split("\n");
  const updatedRows = [];

  for (let i = 0; i < rows.length; i++) {
    const values = rows[i].split(",");
    if (values[0] === keyboardID) {
      values[3] = status;
    }
    updatedRows.push(values.join(","));
  }

  try {
    await fs.promises.writeFile("keyboard.csv", updatedRows.join("\n"));
  } catch (error) {
    console.error(error);
  }

  return { connected: status };
};

export const updateUserColor = async (keyboardID, color) => {
  const data = await fs.promises.readFile("keyboard.csv", "utf8");
  const rows = data.split("\n");
  const updatedRows = [];

  for (let i = 0; i < rows.length; i++) {
    const values = rows[i].split(",");
    if (values[0] === keyboardID) {
      values[2] = color;
    }
    updatedRows.push(values.join(","));
  }

  try {
    await fs.promises.writeFile("keyboard.csv", updatedRows.join("\n"));
  } catch (error) {
    console.error(error);
  }

  return { color };
};
