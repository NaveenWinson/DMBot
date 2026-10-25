export default function Privacy() {
  return (
    <article className="card">
      <h1>Privacy policy</h1>
      <p>DMBot is a private tool that runs on one Instagram professional account, operated by that account's owner.</p>
      <h2>What it processes</h2>
      <p>When someone comments on the owner's reels, Instagram sends DMBot the comment ID, text, the commenter's username and Instagram-scoped ID, and the reel ID. If the comment matches a keyword the owner set up, DMBot sends one private reply and one public reply through the Instagram API.</p>
      <h2>What it stores</h2>
      <p>For matching comments only, DMBot stores the comment ID and text, the commenter's username and ID, and whether each reply was sent. This record is used to avoid replying twice and to show the owner a recent activity list. Nothing is sold or shared with third parties.</p>
      <h2>Deleting your data</h2>
      <p>To have your records removed, send a DM to the account you commented on and ask for your data to be deleted. It will be removed within 30 days.</p>
    </article>
  );
}
