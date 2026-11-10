// Dungeon crawl rules, pack version 1.0 (Inkwright, original rules).
// A game INCLUDEs this through its generated _engine.ink. The story calls -> crawl -> and then reads crawl_result:
// "won" (the warlord in the last room fell), "left" (the crew turned back), "fallen" (nobody is standing).
// Rolls are 2d6 + a stat against 7 + the other side's guard: a hit takes 1 life, beating it by 3 or more takes 2.
// Everything here works on the game's party and the "foe" kind, so a game may change both in its own game.md.

VAR crawl_rooms = 6
VAR crawl_result = ""
VAR depth = 0
VAR fled = false

// The whole expedition: room after room until the last one, unless the crew turns back or falls.
=== crawl ===
~ depth = 0
~ crawl_result = ""
- (next)
{ alive("party") == 0:
    ~ crawl_result = "fallen"
    ->->
}
{ crawl_result == "won":
    ->->
}
{ depth > 0:
    {t("火把还剩 {torches} 支,药水 {potions} 瓶,金币 {gold}。", "{torches} torches left, {potions} potions, {gold} gold.")}
}
+ [{t("往深处走", "Go deeper")}]
    -> enter_room ->
    -> next
+ {depth > 0} [{t("就此回头", "Turn back")}]
    ~ crawl_result = "left"
    ->->

// One room: light a torch, see what is there, deal with it.
=== enter_room ===
~ depth += 1
{ torches > 0:
    ~ torches -= 1
- else:
    ~ temp hurt = pick_one("party", "random")
    {t("没有火把了。{name_of(hurt)}在黑暗里摔了一跤。", "No torches left. {name_of(hurt)} falls in the dark.")}
    ~ hurt_hero(hurt, 1)
}
{ depth >= crawl_rooms:
    {t("最深处的大厅。深渊督军站了起来。", "The deepest hall. The pit warlord rises.")}
    ~ spawn("foe", "warlord")
    -> battle ->
    { fled:
        ~ crawl_result = "left"
    - else:
        { alive("party") > 0:
            ~ crawl_result = "won"
        }
    }
    ->->
}
~ temp r = table_roll("rooms")
~ temp what = table_id("rooms", r)
{t("第 {depth} 间:{table_text("rooms", r)}。", "Room {depth}: {table_text("rooms", r)}.")}
{ what:
- "monsters":
    -> meet ->
- "treasure":
    ~ temp found = roll("2d6") * depth
    ~ gold += found
    {t("箱子里有 {found} 枚金币。", "The chest holds {found} gold.")}
- "trap":
    -> trap ->
- "shrine":
    ~ heal_all(1, 2)
    {t("祭坛前歇了一会儿,每个人都好了些。", "A rest at the shrine; everyone feels better.")}
- else:
    {t("什么也没有。", "Nothing here.")}
}
->->

// Monsters: from the shallow table in the first half of the dungeon, the deep one after.
=== meet ===
{ depth * 2 <= crawl_rooms:
    ~ temp shallow = spawn_from("shallow")
    {t("是{table_text("shallow", shallow)}!", "It is {table_text("shallow", shallow)}!")}
- else:
    ~ temp deep = spawn_from("deep")
    {t("是{table_text("deep", deep)}!", "It is {table_text("deep", deep)}!")}
}
-> battle ->
->->

// A fight: each round one hero strikes the weakest foe, then every foe strikes a random hero.
=== battle ===
~ fled = false
- (round)
{ alive("foe") == 0:
    {t("打完了。", "The fight is over.")}
    ->->
}
{ alive("party") == 0:
    ->->
}
~ temp target = pick_one("foe", "lowest:life")
<- hero_option(1, target)
<- hero_option(2, target)
<- hero_option(3, target)
<- hero_option(4, target)
+ {potions > 0} [{t("喝一瓶药水(伤得最重的人 +3)", "Drink a potion (the most wounded +3)")}]
    ~ potions -= 1
    ~ temp worst = pick_one("party", "lowest:life")
    ~ heal(worst, 3)
    {t("{name_of(worst)}喝下了药水。", "{name_of(worst)} drinks a potion.")}
    ~ foes_act(1)
    -> round
+ [{t("逃出这间屋子", "Flee the room")}]
    {t("你们转身就跑,它们追着砍了一轮。", "You turn and run; they get one more round of blows.")}
    ~ foes_act(1)
    ~ clear_foes()
    ~ fled = true
    ->->

// The k-th standing hero's attack, offered as a choice (nothing when there are fewer heroes standing).
=== hero_option(k, target) ===
~ temp who = nth_one("party", k)
{ who == "":
    -> DONE
}
+ [{t("{name_of(who)}攻击{name_of(target)}", "{name_of(who)} attacks {name_of(target)}")}]
    ~ strike(who, target)
    ~ foes_act(1)
    -> battle.round
- -> DONE

// A hero against a foe: 2d6 + might against 7 + the foe's guard.
=== function strike(who, target) ===
~ temp foe_name = name_of(target)
~ temp margin = roll("2d6") + stat(who, "might") - 7 - stat(target, "guard")
{
- margin >= 3:
    ~ add_stat(target, "life", -2)
    {t("{name_of(who)}重重一击,{foe_name}掉了 2 点生命。", "{name_of(who)} lands a heavy blow: {foe_name} loses 2.")}
- margin >= 0:
    ~ add_stat(target, "life", -1)
    {t("{name_of(who)}打中了{foe_name}。", "{name_of(who)} hits {foe_name}.")}
- else:
    {t("{name_of(who)}没打中。", "{name_of(who)} misses.")}
}

// The k-th foe and the ones after it each strike a random standing hero: 2d6 + attack against 7 + the hero's guard.
=== function foes_act(k) ===
{ k > alive("foe") || alive("party") == 0:
    ~ return
}
~ temp attacker = nth_one("foe", k)
~ temp victim = pick_one("party", "random")
~ temp margin = roll("2d6") + stat(attacker, "attack") - 7 - stat(victim, "guard")
{
- margin >= 3:
    {t("{name_of(attacker)}重创了{name_of(victim)}。", "{name_of(attacker)} badly wounds {name_of(victim)}.")}
    ~ hurt_hero(victim, 2)
- margin >= 0:
    {t("{name_of(attacker)}伤了{name_of(victim)}。", "{name_of(attacker)} wounds {name_of(victim)}.")}
    ~ hurt_hero(victim, 1)
- else:
    {t("{name_of(victim)}挡住了{name_of(attacker)}。", "{name_of(victim)} fends off {name_of(attacker)}.")}
}
~ foes_act(k + 1)

// A loose flagstone: a random hero rolls 2d6 + might, 8 or more to jump clear.
=== trap ===
~ temp who = pick_one("party", "random")
{ roll("2d6") + stat(who, "might") >= 8:
    {t("{name_of(who)}及时跳开了。", "{name_of(who)} jumps clear.")}
- else:
    {t("{name_of(who)}掉进了坑里,伤得不轻。", "{name_of(who)} falls into the pit and is badly hurt.")}
    ~ hurt_hero(who, 2)
}
->->

=== function hurt_hero(who, n) ===
~ add_stat(who, "life", 0 - n)
{ stat(who, "life") <= 0:
    {t("{name_of(who)}倒下了。", "{name_of(who)} goes down.")}
}

=== function heal(who, n) ===
~ set_stat(who, "life", MIN(stat(who, "life") + n, stat(who, "life_max")))

// Heals the k-th standing hero and the ones after.
=== function heal_all(k, n) ===
~ temp who = nth_one("party", k)
{ who != "":
    ~ heal(who, n)
    ~ heal_all(k + 1, n)
}

=== function clear_foes() ===
{ alive("foe") > 0:
    ~ despawn(nth_one("foe", 1))
    ~ clear_foes()
}
