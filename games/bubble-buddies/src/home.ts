/** Home-page online controls: create a room or join one by code. */
import { createRoom, isRoomCodeLike } from './shell/invite';

const createBtn = document.querySelector<HTMLButtonElement>('#create-room');
const joinForm = document.querySelector<HTMLFormElement>('#join-form');
const joinInput = document.querySelector<HTMLInputElement>('#join-code');
const onlineStatus = document.querySelector<HTMLElement>('#online-status');

const say = (text: string): void => {
  if (onlineStatus) onlineStatus.textContent = text;
};

createBtn?.addEventListener('click', () => {
  createBtn.disabled = true;
  say('setting up your room…');
  createRoom()
    .then(({ code }) => {
      location.href = `/play/bubble-buddies/?room=${code}`;
    })
    .catch(() => {
      createBtn.disabled = false;
      say('could not reach the room server — try again in a moment');
    });
});

joinForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = (joinInput?.value ?? '').trim().toUpperCase();
  if (!isRoomCodeLike(code)) {
    say('codes are 4 letters, like BLAB');
    return;
  }
  location.href = `/play/bubble-buddies/?room=${code}`;
});
