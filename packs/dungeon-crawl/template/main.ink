// A dungeon crawl on the pack: the story is only the start and the end; -> crawl -> plays the dungeon.
INCLUDE _engine.ink

~ crawl_rooms = 6
{t("镇上的人说,旧矿井下面有一座地城,最深处守着一个深渊督军。四个人点起火把,走了下去。", "The townsfolk say an old mine leads down into a dungeon, with a pit warlord in its deepest hall. Four of you light your torches and go down.")}
-> crawl ->
{ crawl_result:
- "won":
    {t("督军倒下了。你们带着 {gold} 枚金币回到地面。", "The warlord falls. You come back up with {gold} gold.")}
- "left":
    {t("你们回到地面,带回 {gold} 枚金币。地城还在下面等着。", "You climb back out with {gold} gold. The dungeon is still waiting below.")}
- else:
    {t("火把一支支灭了。没有人回来。", "The torches go out one by one. Nobody comes back.")}
}
-> END
