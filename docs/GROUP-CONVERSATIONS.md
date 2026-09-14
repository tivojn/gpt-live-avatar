# Characters together

Right-click the desktop avatar and choose **Bring Characters Together…** (also in View). Choose two to five installed characters and their voices. Pick conversation, collaborative story, friendly debate or Would you rather, then personalize the topic.

**Live talk** is on by default. With **Join as yourself** checked, **Start live talk** opens the microphone and you can speak at any time. Your speech interrupts the active character. The characters share attributed dialogue and respond to your actual contribution through persistent voice connections. They are instructed never to invent your answer or speak for you. Leave Join unchecked to watch without opening the microphone. You can also type a contribution during live talk.

**Mute microphone** disables capture tracks until you unmute. **Stop**, **Escape** or **Close** closes voice connections and releases the microphone. Hiding the group mutes the microphone immediately and ends the session after approximately 15 seconds. Visible live talk does not have a 15-second time limit. Network or voice-service delays can still affect response time.

Spoken actions work in live talk: say **“Tia, do a kung fu punch”**, **“Sarah, dance”** or **“Iselda, wave.”** Name the character to choose who performs it; otherwise the character you last addressed receives it (or the current speaker if you have not named anyone). **“Tia, stop”** stops her motion. Available motions depend on the installed character pack.

An animated wave in the overhead bubble identifies the speaker. It does not shake the character. Characters look between each other and the audience, returning to audience eye contact when resting. Cursor following is off by default. In the single-avatar view, holding a prop keeps its authored aiming pose instead of forcing camera eye contact.

Drag the visible character or pinch over it to resize. Transparent gaps pass clicks to the app underneath, including gaps inside the character’s rectangular drawing area. **Arrange** or **Cmd+Shift+0** restores the group layout. **Close** returns to the single avatar. Appearance choices and sign-ins are preserved.

Live voices use the configured voice API key. Reasoning requests, when needed, use the reasoning account selected in Settings. Voices are AI generated. Several live characters use separate voice sessions and more GPU memory than one avatar.

## Shared context and addressed requests

Say **“Hi Tia, create shared.txt in the selected folder.”** Then **“Hi Sarah, delete that file.”** Sarah receives the verified filename and result from Tia's tools. Removal moves an explicitly requested individual file to the Mac's Trash, so it is recoverable. The folder selected under Settings → Actions applies to all characters. Folders, symbolic links and permanent deletion are not supported.

All participants receive the shared dialogue and verified action results. Only the character you address answers or acts; she waits for your next contribution. Name someone else to switch, or say **“Everyone, continue the conversation”** to resume the roundtable. The action history survives speaker changes and longer conversations within the open Together window. Closing the window starts a fresh shared context.

Live captions can mishear names. A name-aware transcription of your bounded microphone utterance confirms the addressee before routing or tools run. This uses the voice API key and adds a transcription request and a short recognition delay per spoken contribution; the voice sessions stay connected and interruption is immediate. Audio is held in memory only, up to one minute per contribution, and discarded when live talk ends. If recognition fails, the app asks you to repeat or type instead of guessing an action. Character audio is never relayed through another character's human microphone input.

## Optional reviewed turns

Uncheck **Live talk** for the earlier turn-based mode. Set a character-turn limit, then choose **Start conversation**. With Join enabled, characters invite you in after every two character turns; **I’d like a turn** reserves the next turn. Type a reply, pass, or click **Speak my reply** followed by **Finish recording**. Review and edit the transcription before **Send reply**. The microphone opens only for recording, which is limited to one minute. Recordings are held in memory and not saved locally. A person taking a reviewed turn has no 15-second answer deadline.
