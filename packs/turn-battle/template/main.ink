// A battle on the pack: the story calls up the foes, -> battle -> plays it out, battle_result says how it went.
INCLUDE _engine.ink

{t("山道拐弯的地方,三个影子从石头后面站了起来:一个地精、一个兽人,还有一个摇着骨铃的萨满。", "Where the mountain path bends, three shapes rise from behind the rocks: a goblin, an orc and a shaman shaking a bone rattle.")}
~ spawn("foe", "goblin")
~ spawn("foe", "orc")
~ spawn("foe", "shaman")
-> battle ->
{ battle_result == "won":
    {t("打了 {battle_round} 回合,山道清静了。你们还剩 {potions} 瓶药水。", "After {battle_round} rounds the path is clear. You have {potions} potions left.")}
- else:
    {t("骑士最后一个倒下。骨铃还在响。", "The knight is the last to fall. The rattle keeps shaking.")}
}
-> END
